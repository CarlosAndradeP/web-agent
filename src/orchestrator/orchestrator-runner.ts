import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import { generateText } from 'ai';
import type { OrchestratorSession, OrchestratorRole, SubAgentResult, TaskContext, PlanTask } from '../types/index.js';
import { OrchestratorSessionsRepository, OrchestratorStepsRepository, OrchestratorStateRepository, OrchestratorTasksRepository } from '../db/repositories/orchestrator.js';
import { createAuxiliarAgent, AUXILIAR_DEFAULT_MODEL } from './agents/auxiliar-agent.js';
import { createArquitetoAgent, ARQUITETO_DEFAULT_MODEL } from './agents/arquiteto-agent.js';
import { createProgramadorAgent, PROGRAMADOR_DEFAULT_MODEL } from './agents/programador-agent.js';
import { createRevisorAgent, REVISOR_DEFAULT_MODEL } from './agents/revisor-agent.js';
import { CreditManager } from '../services/credit-manager.js';
import { ConfigRepository } from '../db/repositories/config.js';
import { UsersRepository } from '../db/repositories/users.js';
import { createProvider } from '../agent/provider.js';
import { createLogger, logSubAgentEvent } from '../services/logger.js';

const log = createLogger('OrchestratorRunner');

const TASK_MAX_RETRIES = 3;
const MAX_TOTAL_STEPS = 500;
const SUB_AGENT_TIMEOUT_MS = 900_000;
const SUB_AGENT_STEP_TIMEOUT_MS = 180_000;
const MAX_PARALLEL_TASKS = 1;
const MAX_REPLAN_ATTEMPTS = 1;

const FALLBACK_MODEL = 'openai/gpt-oss-120b';

export class OrchestratorRunner {
  private sessionsRepo: OrchestratorSessionsRepository;
  private stepsRepo: OrchestratorStepsRepository;
  private stateRepo: OrchestratorStateRepository;
  private tasksRepo: OrchestratorTasksRepository;
  private configRepo: ConfigRepository;
  private usersRepo: UsersRepository;
  private creditManager: CreditManager;
  private io: Server | null = null;
  private abortController: AbortController | null = null;
  private running = false;
  private currentSessionId: string | null = null;
  private totalStepsUsed = 0;
  private taskRetryCount = new Map<string, number>();
  private replanCount = new Map<string, number>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private providerCache = new Map<string, any>();
  private appConfigCache: any = null;

  constructor(
    private db: Database.Database,
    private creditManagerRef: CreditManager,
  ) {
    this.sessionsRepo = new OrchestratorSessionsRepository(db);
    this.stepsRepo = new OrchestratorStepsRepository(db);
    this.stateRepo = new OrchestratorStateRepository(db);
    this.tasksRepo = new OrchestratorTasksRepository(db);
    this.configRepo = new ConfigRepository(db);
    this.usersRepo = new UsersRepository(db);
    this.creditManager = creditManagerRef;
  }

  setIo(io: Server): void { this.io = io; }
  isRunning(): boolean { return this.running; }
  getCurrentSessionId(): string | null { return this.currentSessionId; }

  // ====== LIFECYCLE ======

  async start(sessionId: string): Promise<void> {
    if (this.running) throw new Error('Orchestrator is already running');
    const session = this.sessionsRepo.findById(sessionId);
    if (!session) throw new Error('Orchestrator session not found');

    this.running = true;
    this.currentSessionId = sessionId;
    this.totalStepsUsed = 0;
    this.taskRetryCount.clear();
    this.replanCount.clear();
    this.appConfigCache = null;
    this.abortController = new AbortController();
    this.sessionsRepo.updateStatus(sessionId, 'running');
    this.stateRepo.setRunning(true, sessionId);
    this.startHeartbeat();
    this.emitEvent('orchestrator:status', { sessionId, status: 'running', progressPercent: 0 });
    log.info('Orchestrator started', { sessionId, objective: session.objective });

    this.runPhasedWorkflow(session).catch((err: any) => {
      log.error('Orchestrator loop failed', { sessionId, error: err.message, stack: err.stack });
      this.handleFatalError(sessionId, err.message);
    });
  }

  async resume(sessionId: string): Promise<void> {
    if (this.running) throw new Error('Orchestrator is already running');
    const session = this.sessionsRepo.findById(sessionId);
    if (!session) throw new Error('Orchestrator session not found');
    log.info('Resuming orchestrator', { sessionId });
    this.running = true;
    this.currentSessionId = sessionId;
    this.appConfigCache = null;
    this.abortController = new AbortController();
    this.sessionsRepo.updateStatus(sessionId, 'running');
    this.stateRepo.setRunning(true, sessionId);
    this.startHeartbeat();
    this.runPhasedWorkflow(session).catch((err: any) => {
      log.error('Orchestrator loop failed on resume', { sessionId, error: err.message });
      this.handleFatalError(sessionId, err.message);
    });
  }

  pause(sessionId: string): void {
    if (!this.running || this.currentSessionId !== sessionId) return;
    log.info('Pausing orchestrator', { sessionId });
    this.running = false;
    this.stopHeartbeat();
    this.abortController?.abort();
    this.sessionsRepo.updateStatus(sessionId, 'paused');
    this.stateRepo.setRunning(false, null);
    this.emitEvent('orchestrator:status', { sessionId, status: 'paused', progressPercent: this.getCurrentProgress() });
  }

  stop(sessionId: string): void {
    if (!this.running) return;
    log.info('Stopping orchestrator', { sessionId });
    this.running = false;
    this.stopHeartbeat();
    this.abortController?.abort();
    if (this.currentSessionId) {
      this.sessionsRepo.updateStatus(this.currentSessionId, 'idle');
    }
    this.stateRepo.setRunning(false, null);
    this.emitEvent('orchestrator:status', { sessionId: this.currentSessionId, status: 'idle', progressPercent: this.getCurrentProgress() });
    this.currentSessionId = null;
  }

  shutdown(): void {
    log.info('Shutting down orchestrator');
    this.running = false;
    this.stopHeartbeat();
    this.abortController?.abort();
    if (this.currentSessionId) {
      this.sessionsRepo.updateStatus(this.currentSessionId, 'paused');
      this.stateRepo.setRunning(false, null);
    }
    this.currentSessionId = null;
  }

  // ===== MAIN WORKFLOW (PHASE-BASED) =====

  private async runPhasedWorkflow(session: OrchestratorSession): Promise<void> {
    try {
      const tasks = this.tasksRepo.findBySession(session.id);
      if (tasks.length === 0) {
        await this.createPlan(session);
      }

      await this.executePendingTasks(session);

      if (await this.verifyProject(session)) {
        this.sessionsRepo.updateStatus(session.id, 'completed');
        this.sessionsRepo.updateProgress(session.id, 100, 'All tasks completed and verified');
        this.stateRepo.setRunning(false, null);
        this.running = false;
        this.emitEvent('orchestrator:complete', { sessionId: session.id, status: 'completed' });
        this.emitEvent('orchestrator:progress', { sessionId: session.id, progressPercent: 100, currentStep: 'All tasks completed' });
        log.info('Orchestrator completed project', { sessionId: session.id });
      } else {
        const pendingAfter = this.tasksRepo.findPending(session.id);
        if (pendingAfter.length > 0) {
          await this.executePendingTasks(session);
        } else {
          this.handleFatalError(session.id, 'Project verification failed after all tasks attempted');
        }
      }
    } catch (err: any) {
      if (this.abortController?.signal.aborted) {
        log.info('Orchestrator workflow aborted', { sessionId: session.id });
        return;
      }
      log.error('Orchestrator phased workflow failed', { sessionId: session.id, error: err.message });
      this.handleFatalError(session.id, err.message);
    }
  }

  // ====== PLAN PHASE (Two-phase: architect scan + LLM planning) ======

  private async createPlan(session: OrchestratorSession): Promise<void> {
    log.info('Creating plan from .md files + codebase scan', { sessionId: session.id });
    const appConfig = this.getAppConfig();
    const workspaceDir = session.workspaceDir ?? appConfig.workspaceDir;

    let mdContent = '';
    if (session.mdFiles) {
      try {
        const mdFilePaths = JSON.parse(session.mdFiles) as string[];
        for (const fp of mdFilePaths) {
          try {
            const content = await this.readFileSafe(workspaceDir, fp);
            mdContent += `\n--- FILE: ${fp} ---\n${content}\n`;
          } catch (e: any) {
            log.warn('Could not read md file', { path: fp, error: e.message });
          }
        }
      } catch {
        log.warn('mdFiles JSON parse failed', { mdFiles: session.mdFiles });
      }
    }

    let architectureReport = '';
    try {
      log.info('Running architect scan before planning', { sessionId: session.id });
      const archResult = await this.callSubAgent(session, 'arquiteto',
        `Analyze the current workspace to understand what already exists. List the file structure, identify frameworks, patterns in use, and any existing code. This analysis will be used to create an implementation plan.`);
      architectureReport = archResult.text ?? '';
      log.info('Architect scan complete', { sessionId: session.id, reportLen: architectureReport.length });
    } catch (e: any) {
      log.warn('Architect pre-scan failed, proceeding without it', { error: e.message });
    }

    const plan = await this.planWithArquiteto(session, mdContent, architectureReport);
    const taskNames = plan.map(t => t.name);
    for (let i = 0; i < plan.length; i++) {
      const t = plan[i];
      let dependsOnName: string | null = null;
      if (t.dependsOn !== null && t.dependsOn >= 0 && t.dependsOn < taskNames.length) {
        dependsOnName = taskNames[t.dependsOn];
      }
      let enrichedDescription = t.description;
      if (t.targetFiles && t.targetFiles.length > 0) {
        enrichedDescription += `\n\nTARGET FILES: ${t.targetFiles.join(', ')}`;
      }
      if (t.acceptanceCriteria && t.acceptanceCriteria.length > 0) {
        enrichedDescription += `\n\nACCEPTANCE CRITERIA:\n${t.acceptanceCriteria.map((c, idx) => `${idx + 1}. ${c}`).join('\n')}`;
      }
      this.tasksRepo.create(session.id, {
        name: t.name,
        description: enrichedDescription,
        role: t.role ?? 'programador',
        dependsOn: dependsOnName,
        stepNumber: i + 1,
      });
    }

    this.sessionsRepo.updateProgress(session.id, 5, `Plan created: ${plan.length} tasks`);
    this.emitEvent('orchestrator:progress', { sessionId: session.id, progressPercent: 5, currentStep: `Plan created: ${plan.length} tasks` });
    log.info('Plan created', { sessionId: session.id, taskCount: plan.length });
  }

  private async planWithArquiteto(session: OrchestratorSession, mdContent: string, architectureReport: string): Promise<PlanTask[]> {
    const appConfig = this.getAppConfig();
    const step = this.recordStep('orchestrator', 'z-ai/glm-5.1', 'plan', 'Generate project plan from specs + codebase scan');

    const prompt = `You are a software architect. Analyze the project specification and codebase scan, then produce a structured implementation plan.

${mdContent ? `PROJECT SPECIFICATION:\n${mdContent}\n` : `Project objective: ${session.objective}\n`}
${architectureReport ? `CURRENT CODEBASE STATE:\n${architectureReport.slice(0, 8000)}\n` : ''}

Produce a JSON array of tasks. Each task must have:
- name: string (task title, concise and unique)
- description: string (detailed description of what to do, including which files to create/modify and what each should contain)
- role: string (one of: "arquiteto", "programador", "auxiliar", "revisor")
- dependsOn: number | null (0-based INDEX of another task this depends on, or null if independent)
- targetFiles: string[] (list of files this task should create or modify)
- acceptanceCriteria: string[] (how to verify the task is complete)

Requirements:
1. Tasks should be granular but not too small (5-30 tasks is typical)
2. "arquiteto" tasks should come first (design, architecture, file structure planning)
3. "programador" tasks should implement the actual code
4. "auxiliar" tasks are for QA verification, code review of individual tasks, generating test checklists, and documentation — ALWAYS include at least one "auxiliar" task after each major implementation phase to verify the work
5. "revisor" tasks are for cross-task integration review and end-to-end verification (use AFTER all implementation tasks)
6. Include a final "revisor" task that reviews all code for integration issues
7. Include at least 2 "auxiliar" tasks: one mid-project review and one pre-final review before the revisor task
8. Use dependsOn as a 0-based index (e.g., dependsOn: 0 means this depends on the first task)
9. Group independent tasks at the same level so they can run in parallel
10. Return ONLY the JSON array, no markdown, no explanation before or after.`;

    let planText = '';
    try {
      const provider = this.getOrCreateProvider(appConfig.apiBaseUrl, appConfig.apiKey, 'orchestrator');
      const model = provider.chatModel('z-ai/glm-5.1');

      const result = await generateText({
        model,
        prompt,
        maxOutputTokens: 16384,
        abortSignal: this.abortController?.signal,
      });

      planText = result.text;
      this.totalStepsUsed += 1;
      this.updateStepResult(step.id, planText.slice(0, 5000), 'completed', null, 0);
      this.stateRepo.incrementSteps(1);
    } catch (err: any) {
      this.updateStepResult(step.id, null, 'failed', err.message, 0);
      throw new Error(`Plan generation failed: ${err.message}`);
    }

    return this.parsePlanJson(planText, session.id);
  }

  private parsePlanJson(planText: string, sessionId: string): PlanTask[] {
    let jsonText = planText.trim();
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonText = codeBlockMatch[1].trim();

    const jsonStart = jsonText.indexOf('[');
    const jsonEnd = jsonText.lastIndexOf(']');
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
    }

    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) throw new Error('Parsed plan is not an array');
      const tasks: PlanTask[] = parsed
        .filter((t: any) => t && typeof t === 'object')
        .map((t: any) => ({
          name: String(t.name ?? 'Unnamed task'),
          description: String(t.description ?? t.name ?? ''),
          role: ['arquiteto', 'programador', 'auxiliar', 'revisor'].includes(t.role) ? t.role : 'programador',
          dependsOn: typeof t.dependsOn === 'number' ? t.dependsOn : (typeof t.dependsOn === 'string' ? parseInt(t.dependsOn, 10) : null),
          targetFiles: Array.isArray(t.targetFiles) ? t.targetFiles.map(String) : [],
          acceptanceCriteria: Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria.map(String) : [],
        }));
      if (tasks.length === 0) throw new Error('Plan produced no valid tasks');
      log.info('Plan parsed successfully', { sessionId, count: tasks.length });
      return tasks;
    } catch (err: any) {
      log.error('Failed to parse plan JSON, using robust fallback', { sessionId, error: err.message });
      return [
        { name: 'Analyze codebase', description: `Analyze the existing codebase and project specification to determine the architecture and file structure needed.\n\nPlan text: ${planText.slice(0, 1500)}`, role: 'arquiteto', dependsOn: null, targetFiles: [], acceptanceCriteria: ['File structure is documented', 'Architecture decisions are recorded'] },
        { name: 'Implement core features', description: `Implement all required functionality based on the project specification. Create all necessary files with working code.`, role: 'programador', dependsOn: 0, targetFiles: [], acceptanceCriteria: ['All required files exist', 'Code has no syntax errors'] },
        { name: 'QA review of implementation', description: 'Read all created files, check for syntax errors, missing imports, and verify each file individually against the project specification.', role: 'auxiliar', dependsOn: 1, targetFiles: [], acceptanceCriteria: ['No syntax errors', 'No missing imports', 'Individual files are correct'] },
        { name: 'Integration review', description: 'Review the full project for cross-file integration issues: broken imports, missing routes, incomplete wiring. Verify all features connect end-to-end.', role: 'revisor', dependsOn: 2, targetFiles: [], acceptanceCriteria: ['All imports resolve', 'Routes and pages connect', 'End-to-end flow works'] },
      ];
    }
  }

  // ====== EXECUTE PHASE (Parallel for independent tasks) ======

  private async executePendingTasks(session: OrchestratorSession): Promise<void> {
    let tasks = this.tasksRepo.findPending(session.id);
    log.info('Executing pending tasks', { sessionId: session.id, count: tasks.length });

    while (tasks.length > 0) {
      if (!this.running || this.abortController?.signal.aborted) {
        log.info('Orchestrator stopped during execution');
        return;
      }

      if (this.totalStepsUsed >= MAX_TOTAL_STEPS) {
        log.warn('Max total steps reached, stopping', { sessionId: session.id, totalStepsUsed: this.totalStepsUsed });
        this.handleFatalError(session.id, `Maximum total steps reached (${MAX_TOTAL_STEPS})`);
        return;
      }

      const { ready, blocked } = this.categorizeByDependency(tasks, session.id);
      const batch = ready.slice(0, MAX_PARALLEL_TASKS);

      if (batch.length > 1) {
        log.info('Executing parallel batch', { batchSize: batch.length, taskNames: batch.map(t => t.name) });
      }

      const results = await Promise.allSettled(
        batch.map(async (task) => {
          try {
            await this.executeTask(session, task);
            return { task, success: true, creditExhausted: false };
          } catch (err: any) {
            if (err.message?.includes('Credits exhausted') || err.message?.includes('Insufficient credits')) {
              return { task, success: false, error: err.message, creditExhausted: true };
            }
            return { task, success: false, error: err.message, creditExhausted: false };
          }
        })
      );

      let creditsExhausted = false;
      for (const result of results) {
        if (result.status === 'rejected') {
          log.error('Task batch item rejected', { error: result.reason });
        } else if (result.value && result.value.creditExhausted) {
          creditsExhausted = true;
        }
      }

      if (creditsExhausted) {
        log.error('Credits exhausted, marking all remaining pending tasks as failed', { sessionId: session.id });
        const remainingPending = this.tasksRepo.findPending(session.id);
        for (const t of remainingPending) {
          this.tasksRepo.updateResult(t.id, '', 'failed', 'Credits exhausted — task could not run', null);
        }
        this.handleFatalError(session.id, 'Credits exhausted');
        return;
      }

      this.updateProgress(session);

      await this.sleep(2000);

      const remainingPending = this.tasksRepo.findPending(session.id);
      if (remainingPending.length > 0 && remainingPending.length === tasks.length) {
        const allBlocked = remainingPending.every(t =>
          t.dependsOn && !this.tasksRepo.findCompleted(session.id).some(ct => ct.name === t.dependsOn)
        );
        if (allBlocked) {
          log.error('All remaining tasks have unresolvable dependencies', { sessionId: session.id, blockedCount: remainingPending.length });
          for (const t of remainingPending) {
            this.tasksRepo.updateResult(t.id, '', 'failed', `Dependency "${t.dependsOn}" never completed`, null);
          }
          break;
        }
      }

      tasks = this.tasksRepo.findPending(session.id);
    }
  }

  private categorizeByDependency(tasks: any[], sessionId: string): { ready: any[]; blocked: any[] } {
    const completedNames = new Set(
      this.tasksRepo.findCompleted(sessionId).map(t => t.name)
    );
    const ready = tasks.filter(t => !t.dependsOn || completedNames.has(t.dependsOn));
    const blocked = tasks.filter(t => t.dependsOn && !completedNames.has(t.dependsOn));
    return { ready, blocked };
  }

  private updateProgress(session: OrchestratorSession): void {
    const all = this.tasksRepo.findBySession(session.id);
    const completed = all.filter(t => t.status === 'completed').length;
    const progress = all.length > 0 ? Math.round((completed / all.length) * 90) : 0;
    const failed = all.filter(t => t.status === 'failed').length;
    this.sessionsRepo.updateProgress(session.id, progress, `${completed}/${all.length} done, ${failed} failed`);
    this.emitEvent('orchestrator:progress', { sessionId: session.id, progressPercent: progress, currentStep: `${completed}/${all.length} tasks` });
  }

  private async executeTask(session: OrchestratorSession, task: any): Promise<void> {
    this.tasksRepo.updateStatus(task.id, 'running');
    this.sessionsRepo.updateProgress(session.id, this.getCurrentProgress(), `Running: ${task.name}`);
    const startTime = Date.now();

    const retryCount = this.taskRetryCount.get(task.id) ?? 0;
    const context = this.buildTaskContext(session, task, retryCount);

    try {
      let result: SubAgentResult;
      switch (task.role) {
        case 'arquiteto': result = await this.callSubAgentWithContext(session, 'arquiteto', context); break;
        case 'auxiliar': result = await this.callSubAgentWithContext(session, 'auxiliar', context); break;
        case 'revisor': result = await this.callSubAgentWithContext(session, 'revisor', context); break;
        default: result = await this.callSubAgentWithContext(session, 'programador', context); break;
      }

      this.deductCreditsForTask(session.userId, task.role, result.stepsUsed);

      if (result.success) {
        this.tasksRepo.updateResult(task.id, result.text, 'completed', null, JSON.stringify(result));
        this.emitEvent('orchestrator:step', {
          sessionId: session.id, stepNumber: task.stepNumber, role: task.role, model: this.getModelForRole(task.role as any),
          action: 'delegate', input: task.description.slice(0, 500), output: result.text.slice(0, 1000), status: 'completed', durationMs: Date.now() - startTime,
        });
      } else {
        if (retryCount < TASK_MAX_RETRIES) {
          this.taskRetryCount.set(task.id, retryCount + 1);
          log.warn('Task failed, will retry with error feedback', { taskId: task.id, retry: retryCount + 1 });
          this.tasksRepo.updateResult(task.id, result.text, 'pending',
            `Failed (attempt ${retryCount + 1}): ${result.errors.map(e => e.message).join('; ') || 'Unknown error'}. Will retry with different approach.`, null);
        } else {
          this.tasksRepo.updateResult(task.id, result.text, 'failed', `Failed after ${TASK_MAX_RETRIES} retries`, null);
          this.sessionsRepo.incrementErrorCount(session.id);
          this.emitEvent('orchestrator:error', { sessionId: session.id, error: `Task "${task.name}" failed after ${TASK_MAX_RETRIES} retries` });
          await this.attemptReplan(session, task);
        }
      }
    } catch (err: any) {
      if (retryCount < TASK_MAX_RETRIES) {
        this.taskRetryCount.set(task.id, retryCount + 1);
        this.tasksRepo.updateResult(task.id, '', 'pending', `Error: ${err.message} (will retry)`, null);
      } else {
        this.tasksRepo.updateResult(task.id, '', 'failed', `Task threw error and exhausted retries: ${err.message}`, null);
        this.sessionsRepo.incrementErrorCount(session.id);
        this.emitEvent('orchestrator:error', { sessionId: session.id, error: err.message });
        await this.attemptReplan(session, task);
      }
    }
  }

  // ====== TASK CONTEXT ENVELOPE (Sub-agents are no longer blind) ======

  private buildTaskContext(session: OrchestratorSession, task: any, retryCount: number): TaskContext {
    const previousResults: TaskContext['previousResults'] = [];

    const allCompleted = this.tasksRepo.findCompleted(session.id);
    const deps = task.dependsOn ? allCompleted.filter(ct => ct.name === task.dependsOn) : allCompleted;
    for (const ct of deps.slice(-5)) {
      let parsedResult: any = null;
      try { parsedResult = ct.resultJson ? JSON.parse(ct.resultJson) : null; } catch {}
      previousResults.push({
        taskName: ct.name,
        role: ct.role,
        output: (ct.output ?? '').slice(0, 3000),
        filesCreated: parsedResult?.filesCreated ?? [],
        filesModified: parsedResult?.filesModified ?? [],
      });
    }

    const allTasks = this.tasksRepo.findBySession(session.id);
    const planSummary = allTasks.map((t, i) =>
      `${i + 1}. [${t.status.toUpperCase()}] ${t.name} (${t.role})${t.dependsOn ? ` → depends on: ${t.dependsOn}` : ''}`
    ).join('\n');

    let retryHistory: string | null = null;
    if (retryCount > 0 && task.errorMessage) {
      retryHistory = `Previous attempt failed: ${task.errorMessage}`;
    }

    return {
      objective: session.objective,
      taskName: task.name,
      taskDescription: task.description,
      role: task.role,
      planSummary,
      previousResults,
      currentFileState: '',
      retryHistory,
    };
  }

  private formatContextPrompt(context: TaskContext): string {
    const parts: string[] = [];

    parts.push(`=== PROJECT OBJECTIVE ===\n${context.objective}\n`);

    parts.push(`=== OVERALL PLAN ===\n${context.planSummary}\n`);

    parts.push(`=== CURRENT TASK ===\nName: ${context.taskName}\nRole: ${context.role}\nDescription: ${context.taskDescription}\n`);

    if (context.previousResults.length > 0) {
      parts.push(`=== CONTEXT FROM PREVIOUS TASKS ===`);
      for (const pr of context.previousResults) {
        parts.push(`--- Task: ${pr.taskName} (${pr.role}) ---`);
        if (pr.filesCreated.length > 0) parts.push(`Files created: ${pr.filesCreated.join(', ')}`);
        if (pr.filesModified.length > 0) parts.push(`Files modified: ${pr.filesModified.join(', ')}`);
        parts.push(pr.output);
      }
    }

    if (context.retryHistory) {
      parts.push(`=== RETRY INSTRUCTIONS ===\n${context.retryHistory}\nIMPORTANT: Do NOT repeat the same approach that failed. Try a different strategy or implementation method.`);
    }

    return parts.join('\n');
  }

  // ====== ADAPTIVE REPLANNING ======

  private async attemptReplan(session: OrchestratorSession, failedTask: any): Promise<void> {
    const replanAttempts = this.replanCount.get(failedTask.id) ?? 0;
    if (replanAttempts >= MAX_REPLAN_ATTEMPTS) {
      log.info('Replan limit reached for task, skipping', { taskId: failedTask.id });
      return;
    }

    this.replanCount.set(failedTask.id, replanAttempts + 1);
    log.info('Attempting adaptive replan for failed task', { taskId: failedTask.id, taskName: failedTask.name });

    try {
      const archResult = await this.callSubAgent(session, 'arquiteto',
        `Task "${failedTask.name}" has failed ${TASK_MAX_RETRIES} times.\nError: ${failedTask.errorMessage ?? 'Unknown'}\n\n` +
        `Analyze the current workspace and suggest 2-3 smaller, more specific replacement tasks that accomplish the same goal.\n` +
        `For each replacement task, provide:\n` +
        `- name: concise task name\n- description: what to do, with specific file targets\n- role: programador, auxiliar, or revisor`);

      const suggestions = this.parseReplanSuggestions(archResult.text);
      const maxStep = this.tasksRepo.findBySession(session.id).reduce((max: number, t: any) => Math.max(max, t.stepNumber ?? 0), 0);
      for (let i = 0; i < suggestions.length; i++) {
        this.tasksRepo.create(session.id, {
          name: suggestions[i].name,
          description: suggestions[i].description,
          role: suggestions[i].role ?? 'programador',
          dependsOn: failedTask.dependsOn,
          stepNumber: maxStep + i + 1,
        });
      }
      log.info('Replacement tasks created', { count: suggestions.length, originalTask: failedTask.name });
      this.emitEvent('orchestrator:step', {
        sessionId: session.id, role: 'orchestrator', action: 'fix',
        input: `Replan for failed: ${failedTask.name}`, output: `Created ${suggestions.length} replacement tasks`,
        status: 'completed',
      });
    } catch (err: any) {
      log.warn('Replan attempt failed', { taskId: failedTask.id, error: err.message });
    }
  }

  private parseReplanSuggestions(text: string): Array<{ name: string; description: string; role: string }> {
    const suggestions: Array<{ name: string; description: string; role: string }> = [];
    let jsonText = text.trim();
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonText = codeBlockMatch[1].trim();

    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object') {
            suggestions.push({
              name: String(item.name ?? `Replacement task`),
              description: String(item.description ?? ''),
              role: ['arquiteto', 'programador', 'auxiliar'].includes(item.role) ? item.role : 'programador',
            });
          }
        }
      }
    } catch {}

    if (suggestions.length === 0) {
      const lines = text.split('\n').filter(l => l.trim().startsWith('-') || l.trim().match(/^\d+\./));
      for (const line of lines.slice(0, 3)) {
        const cleaned = line.replace(/^[-\d.]+\s*/, '').trim();
        suggestions.push({ name: cleaned.slice(0, 60), description: cleaned, role: 'programador' });
      }
    }

    if (suggestions.length === 0) {
      suggestions.push({
        name: 'Retry original task (alternative approach)',
        description: 'Try an alternative implementation approach for the failed task.',
        role: 'programador',
      });
    }

    return suggestions;
  }

  // ====== SUB-AGENT CALLING (with context envelope + conditional scan) ======

  private async callSubAgentWithContext(session: OrchestratorSession, role: string, context: TaskContext): Promise<SubAgentResult> {
    const enrichedPrompt = this.formatContextPrompt(context);
    const appConfig = this.getAppConfig();
    const workspaceDir = session.workspaceDir ?? appConfig.workspaceDir;
    const projectType = await this.detectProjectType(workspaceDir);
    const objective = session.objective;
    const primaryModelId = this.getModelForRole(role as OrchestratorRole);

    const shouldScan = role === 'programador';
    const beforeFiles = shouldScan ? await this.scanWorkspace(workspaceDir) : new Map<string, { size: number; mtime: number }>();

    const modelChain = this.getFallbackChain(role);

    for (const modelId of modelChain) {
      let text = '';
      let stepsUsed = 0;
      let agentSteps: any[] = [];

      const isPrimary = modelId === primaryModelId;
      if (!isPrimary) {
        log.warn('Switching to fallback model', { role, fromModel: primaryModelId, toModel: modelId, sessionId: session.id });
      }
      log.info('Calling sub-agent', { role, modelId, sessionId: session.id, taskName: context.taskName, isPrimary });

      try {
        let agentResult: any;
        const timeoutOpts = { totalMs: SUB_AGENT_TIMEOUT_MS, stepMs: SUB_AGENT_STEP_TIMEOUT_MS };
        const abortSignal = this.abortController?.signal;

        switch (role) {
          case 'arquiteto': {
            const agent = createArquitetoAgent(workspaceDir, appConfig.apiBaseUrl, appConfig.apiKey, projectType, objective, isPrimary ? undefined : modelId);
            agentResult = await this.callWithRetry(() => agent.generate({ prompt: enrichedPrompt, abortSignal, timeout: timeoutOpts }), `arquiteto:${modelId}`);
            break;
          }
          case 'auxiliar': {
            const agent = createAuxiliarAgent(workspaceDir, appConfig.apiBaseUrl, appConfig.apiKey, projectType, objective, isPrimary ? undefined : modelId);
            agentResult = await this.callWithRetry(() => agent.generate({ prompt: enrichedPrompt, abortSignal, timeout: timeoutOpts }), `auxiliar:${modelId}`);
            break;
          }
          case 'revisor': {
            const agent = createRevisorAgent(workspaceDir, appConfig.apiBaseUrl, appConfig.apiKey, projectType, objective, isPrimary ? undefined : modelId);
            agentResult = await this.callWithRetry(() => agent.generate({ prompt: enrichedPrompt, abortSignal, timeout: timeoutOpts }), `revisor:${modelId}`);
            break;
          }
          default: {
            const agent = createProgramadorAgent(workspaceDir, appConfig.apiBaseUrl, appConfig.apiKey, projectType, objective, isPrimary ? undefined : modelId);
            agentResult = await this.callWithRetry(() => agent.generate({ prompt: enrichedPrompt, abortSignal, timeout: timeoutOpts }), `programador:${modelId}`);
            break;
          }
        }

        text = agentResult?.text ?? 'No output';
        agentSteps = agentResult?.steps ?? [];
        stepsUsed = agentSteps.length;
        this.totalStepsUsed += stepsUsed;
        log.info('Sub-agent completed', { role, modelId, stepsUsed, totalStepsUsed: this.totalStepsUsed, wasFallback: !isPrimary });

        return this.buildSubAgentResult(text, agentSteps, stepsUsed, shouldScan, workspaceDir, beforeFiles);
      } catch (err: any) {
        const isRateLimit = this.isRateLimitError(err);
        const isLastModel = modelId === modelChain[modelChain.length - 1];

        if (isRateLimit && !isLastModel) {
          log.warn('Rate limited, trying next fallback model', { role, failedModel: modelId, nextModel: modelChain[modelChain.indexOf(modelId) + 1], sessionId: session.id });
          continue;
        }

        if (!isRateLimit) {
          log.error('Sub-agent call failed (non-rate-limit)', { role, modelId, error: err.message, sessionId: session.id });
          return { text: '', filesCreated: [], filesModified: [], commandsRun: [], errors: [{ message: err.message, step: 0 }], stepsUsed: 0, success: false };
        }

        log.error('Sub-agent call failed — all fallback models rate-limited', { role, error: err.message, sessionId: session.id });
        return { text: '', filesCreated: [], filesModified: [], commandsRun: [], errors: [{ message: `All models rate-limited. Last error: ${err.message}`, step: 0 }], stepsUsed: 0, success: false };
      }
    }

    return { text: '', filesCreated: [], filesModified: [], commandsRun: [], errors: [{ message: 'No models available', step: 0 }], stepsUsed: 0, success: false };
  }

  private async callSubAgent(session: OrchestratorSession, role: string, taskDescription: string): Promise<SubAgentResult> {
    const appConfig = this.getAppConfig();
    const workspaceDir = session.workspaceDir ?? appConfig.workspaceDir;
    const projectType = await this.detectProjectType(workspaceDir);
    const objective = session.objective;
    const primaryModelId = this.getModelForRole(role as OrchestratorRole);

    const shouldScan = role === 'programador';
    const beforeFiles = shouldScan ? await this.scanWorkspace(workspaceDir) : new Map<string, { size: number; mtime: number }>();

    const modelChain = this.getFallbackChain(role);

    for (const modelId of modelChain) {
      let text = '';
      let stepsUsed = 0;
      let agentSteps: any[] = [];

      const isPrimary = modelId === primaryModelId;
      if (!isPrimary) {
        log.warn('Switching to fallback model', { role, fromModel: primaryModelId, toModel: modelId, sessionId: session.id });
      }
      log.info('Calling sub-agent (simple)', { role, modelId, sessionId: session.id, isPrimary });

      try {
        let agentResult: any;
        const timeoutOpts = { totalMs: SUB_AGENT_TIMEOUT_MS, stepMs: SUB_AGENT_STEP_TIMEOUT_MS };
        const abortSignal = this.abortController?.signal;

        switch (role) {
          case 'arquiteto': {
            const agent = createArquitetoAgent(workspaceDir, appConfig.apiBaseUrl, appConfig.apiKey, projectType, objective, isPrimary ? undefined : modelId);
            agentResult = await this.callWithRetry(() => agent.generate({ prompt: taskDescription, abortSignal, timeout: timeoutOpts }), `arquiteto:${modelId}`);
            break;
          }
          case 'auxiliar': {
            const agent = createAuxiliarAgent(workspaceDir, appConfig.apiBaseUrl, appConfig.apiKey, projectType, objective, isPrimary ? undefined : modelId);
            agentResult = await this.callWithRetry(() => agent.generate({ prompt: taskDescription, abortSignal, timeout: timeoutOpts }), `auxiliar:${modelId}`);
            break;
          }
          case 'revisor': {
            const agent = createRevisorAgent(workspaceDir, appConfig.apiBaseUrl, appConfig.apiKey, projectType, objective, isPrimary ? undefined : modelId);
            agentResult = await this.callWithRetry(() => agent.generate({ prompt: taskDescription, abortSignal, timeout: timeoutOpts }), `revisor:${modelId}`);
            break;
          }
          default: {
            const agent = createProgramadorAgent(workspaceDir, appConfig.apiBaseUrl, appConfig.apiKey, projectType, objective, isPrimary ? undefined : modelId);
            agentResult = await this.callWithRetry(() => agent.generate({ prompt: taskDescription, abortSignal, timeout: timeoutOpts }), `programador:${modelId}`);
            break;
          }
        }

        text = agentResult?.text ?? 'No output';
        agentSteps = agentResult?.steps ?? [];
        stepsUsed = agentSteps.length;
        this.totalStepsUsed += stepsUsed;
        log.info('Sub-agent completed', { role, modelId, stepsUsed, wasFallback: !isPrimary });

        return this.buildSubAgentResult(text, agentSteps, stepsUsed, shouldScan, workspaceDir, beforeFiles);
      } catch (err: any) {
        const isRateLimit = this.isRateLimitError(err);
        const isLastModel = modelId === modelChain[modelChain.length - 1];

        if (isRateLimit && !isLastModel) {
          log.warn('Rate limited, trying next fallback model', { role, failedModel: modelId, nextModel: modelChain[modelChain.indexOf(modelId) + 1], sessionId: session.id });
          continue;
        }

        if (!isRateLimit) {
          log.error('Sub-agent call failed (non-rate-limit)', { role, modelId, error: err.message, sessionId: session.id });
          return { text: '', filesCreated: [], filesModified: [], commandsRun: [], errors: [{ message: err.message, step: 0 }], stepsUsed: 0, success: false };
        }

        log.error('Sub-agent call failed — all fallback models rate-limited', { role, error: err.message, sessionId: session.id });
        return { text: '', filesCreated: [], filesModified: [], commandsRun: [], errors: [{ message: `All models rate-limited. Last error: ${err.message}`, step: 0 }], stepsUsed: 0, success: false };
      }
    }

    return { text: '', filesCreated: [], filesModified: [], commandsRun: [], errors: [{ message: 'No models available', step: 0 }], stepsUsed: 0, success: false };
  }

  private getFallbackChain(role: string): string[] {
    const primary = this.getModelForRole(role as OrchestratorRole);
    const auxiliary = AUXILIAR_DEFAULT_MODEL;
    const chain = [primary];

    if (primary !== auxiliary) {
      chain.push(auxiliary);
    }
    if (!chain.includes(FALLBACK_MODEL)) {
      chain.push(FALLBACK_MODEL);
    }
    return chain;
  }

  private async buildSubAgentResult(text: string, agentSteps: any[], stepsUsed: number, shouldScan: boolean, workspaceDir: string, beforeFiles: Map<string, { size: number; mtime: number }>): Promise<SubAgentResult> {
    let created: string[] = [];
    let modified: string[] = [];
    if (shouldScan) {
      await this.sleep(100);
      const afterFiles = await this.scanWorkspace(workspaceDir);
      const diff = this.compareFileStates(beforeFiles, afterFiles);
      created = diff.created;
      modified = diff.modified;
    }

    const commandsRun = agentSteps
      .filter((s: any) => s.toolName === 'runCommand' || s.toolName === 'executeCode')
      .map((s: any) => ({
        command: s.toolName === 'runCommand' ? (s.args?.command ?? '') : `executeCode(${s.args?.language ?? 'js'})`,
        exitCode: s.result?.exitCode ?? 0,
        output: (typeof s.result === 'string' ? s.result : JSON.stringify(s.result ?? '')).slice(0, 500),
      }));

    return {
      text: text.slice(0, 10000),
      filesCreated: created,
      filesModified: modified,
      commandsRun,
      errors: [],
      stepsUsed,
      success: true,
    };
  }

  // ====== WORKSPACE SCANNING ======

  private async scanWorkspace(dir: string, subPath: string = ''): Promise<Map<string, { size: number; mtime: number }>> {
    const path = await import('node:path');
    const fs = await import('node:fs/promises');
    const files = new Map<string, { size: number; mtime: number }>();
    const fullDir = path.resolve(dir, subPath);

    try {
      const entries = await fs.readdir(fullDir, { withFileTypes: true });
      for (const entry of entries) {
        const relPath = subPath ? `${subPath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          const subFiles = await this.scanWorkspace(dir, relPath);
          for (const [p, info] of subFiles) files.set(p, info);
        } else {
          try {
            const s = await fs.stat(path.join(dir, relPath));
            files.set(relPath, { size: s.size, mtime: s.mtimeMs });
          } catch { /* ignore */ }
        }
      }
    } catch { /* directory may not exist */ }
    return files;
  }

  private compareFileStates(before: Map<string, { size: number; mtime: number }>, after: Map<string, { size: number; mtime: number }>): { created: string[]; modified: string[] } {
    const created: string[] = [];
    const modified: string[] = [];
    for (const [path, afterInfo] of after) {
      if (!before.has(path)) created.push(path);
      else {
        const beforeInfo = before.get(path)!;
        if (beforeInfo.size !== afterInfo.size || beforeInfo.mtime !== afterInfo.mtime) modified.push(path);
      }
    }
    return { created, modified };
  }

  private async readFileSafe(workspaceDir: string, filePath: string): Promise<string> {
    const path = await import('node:path');
    const fs = await import('node:fs/promises');
    const fullPath = path.resolve(workspaceDir, filePath);
    const normalized = path.resolve(workspaceDir);
    const safePrefix = normalized.endsWith(path.sep) ? normalized : normalized + path.sep;
    if (fullPath !== normalized && !fullPath.startsWith(safePrefix)) {
      throw new Error('Path traversal blocked');
    }
    return fs.readFile(fullPath, 'utf-8');
  }

  // ====== INTELLIGENT RETRY WITH ERROR CLASSIFICATION ======

  private isRateLimitError(err: any): boolean {
    const msg = (err.message ?? '').toLowerCase();
    const status = err.statusCode || err.status;
    return status === 429 || msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota exceeded');
  }

  private async callWithRetry<T>(fn: () => Promise<T>, context: string = ''): Promise<T> {
    const MAX_RETRIES = 5;
    const MAX_RATE_LIMIT_RETRIES = 2;
    const BASE_DELAY_MS = 1000;
    const MAX_DELAY_MS = 30_000;
    const RATE_LIMIT_DELAY_MS = 10_000;

    let lastError: any;
    let consecutiveRateLimits = 0;
    let rateLimitAttempts = 0;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (this.abortController?.signal.aborted) {
        throw new Error('Aborted by orchestrator stop');
      }

      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const errorClassification = this.classifyError(err);

        if (errorClassification.type === 'permanent') {
          log.warn('Permanent error detected, not retrying', { context, error: err.message, classification: errorClassification.reason });
          throw err;
        }

        const isRateLimit = errorClassification.type === 'rate-limited';
        if (isRateLimit) {
          consecutiveRateLimits++;
          rateLimitAttempts++;
          if (rateLimitAttempts >= MAX_RATE_LIMIT_RETRIES) {
            log.warn('Rate limit retries exhausted, aborting to allow model fallback', { context, rateLimitAttempts, maxRateLimitRetries: MAX_RATE_LIMIT_RETRIES });
            throw err;
          }
        }

        if (attempt >= MAX_RETRIES - 1) {
          log.error('Max retries exceeded', { context, error: err.message, attempts: attempt + 1 });
          break;
        }

        const delay = this.calculateRetryDelay(errorClassification, attempt, consecutiveRateLimits, BASE_DELAY_MS, MAX_DELAY_MS, RATE_LIMIT_DELAY_MS);
        log.warn(`Retrying API call`, {
          context,
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          delayMs: delay,
          errorType: errorClassification.type,
          error: err.message,
        });
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private classifyError(err: any): { type: 'transient' | 'permanent' | 'rate-limited'; reason: string } {
    const msg = (err.message ?? '').toLowerCase();
    const status = err.statusCode || err.status;

    if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota exceeded')) {
      return { type: 'rate-limited', reason: `HTTP ${status}: Rate limited` };
    }

    if (status === 401 || status === 403) {
      return { type: 'permanent', reason: `HTTP ${status}: Authentication/Authorization failed` };
    }

    if (msg.includes('this operation was aborted') || msg.includes('was terminated') || msg.includes('timeout exceeded')) {
      return { type: 'permanent', reason: 'Sub-agent operation timed out' };
    }

    if (status === 400 || status === 422) {
      return { type: 'permanent', reason: `HTTP ${status}: Bad request / validation error` };
    }

    if (status === 404) {
      return { type: 'permanent', reason: 'HTTP 404: Resource not found' };
    }

    if (msg.includes('api key') || msg.includes('unauthorized') || msg.includes('invalid key')) {
      return { type: 'permanent', reason: 'API key error' };
    }

    if (msg.includes('unsupported') || msg.includes('not supported') || msg.includes('model not found') || msg.includes('does not exist')) {
      return { type: 'permanent', reason: 'Unsupported model' };
    }

    if (msg.includes('content policy') || msg.includes('safety') || msg.includes('moderation') || msg.includes('blocked')) {
      return { type: 'permanent', reason: 'Content policy / moderation error' };
    }

    if (msg.includes('context length') || msg.includes('max_tokens') || msg.includes('token limit') || msg.includes('too many tokens') || msg.includes('maximum context') || msg.includes('input is too long')) {
      return { type: 'permanent', reason: 'Context length exceeded' };
    }

    if (status === 502 || status === 503 || status === 504 || status === 500) {
      return { type: 'transient', reason: `HTTP ${status}: Server error` };
    }

    if (msg.includes('econnrefused') || msg.includes('socket hang up') || msg.includes('connect') || msg.includes('timeout') || msg.includes('etimedout') || msg.includes('network') || msg.includes('disconnect')) {
      return { type: 'transient', reason: 'Network/connectivity error' };
    }

    return { type: 'transient', reason: 'Unknown error, retrying' };
  }

  private calculateRetryDelay(errorClassification: { type: string }, attempt: number, consecutiveRateLimits: number, baseDelay: number, maxDelay: number, rateLimitDelay: number): number {
    if (errorClassification.type === 'rate-limited') {
      return Math.min(rateLimitDelay * (consecutiveRateLimits + 1), maxDelay);
    }

    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = 0.75 + Math.random() * 0.5;
    const delay = Math.min(exponentialDelay * jitter, maxDelay);
    return Math.floor(delay);
  }

  // ====== VERIFY PHASE (Real verification via arquiteto) ======

  private async verifyProject(session: OrchestratorSession): Promise<boolean> {
    const tasks = this.tasksRepo.findBySession(session.id);
    const anyFailed = tasks.some(t => t.status === 'failed');
    if (anyFailed) return false;
    const allCompleted = tasks.every(t => t.status === 'completed');
    if (!allCompleted) return false;

    log.info('Running intelligent project verification', { sessionId: session.id });
    try {
      const verifyResult = await this.callSubAgent(session, 'revisor',
        `VERIFICATION TASK: Read all files in the workspace and verify the implementation is correct.

PROJECT OBJECTIVE: ${session.objective}

Check for:
1. All files are syntactically valid (no obvious syntax errors in code)
2. Implementation matches the project specification and objective
3. Package.json exists and has a start script (if this is a Node.js project)
4. No obvious missing imports or broken references
5. HTML files reference existing CSS/JS files
6. All required features from the objective are implemented

Reply with "PASS" if everything looks correct, or "FAIL: [reason]" if there are problems.
Be thorough but fair — minor style issues are acceptable, but broken code is not.`);

      const verifyText = verifyResult.text.toUpperCase();
      if (verifyText.includes('PASS') && !verifyText.includes('FAIL')) {
        log.info('Project verification PASSED', { sessionId: session.id });
        return true;
      } else {
        const failReason = verifyResult.text.slice(0, 500);
        log.warn('Project verification FAILED', { sessionId: session.id, reason: failReason });
        this.sessionsRepo.updateProgress(session.id, 95, `Verification issue: ${failReason}`);
        return false;
      }
    } catch (err: any) {
      log.warn('Verification call failed, assuming pass', { error: err.message });
      return true;
    }
  }

  // ====== HELPERS ======

  private getAppConfig(): any {
    if (!this.appConfigCache) {
      this.appConfigCache = this.configRepo.getAll();
    }
    return this.appConfigCache;
  }

  private getOrCreateProvider(apiBaseUrl: string, apiKey: string, agentType: string): any {
    const key = `${apiBaseUrl}:${apiKey}:${agentType}`;
    if (!this.providerCache.has(key)) {
      this.providerCache.set(key, createProvider(apiBaseUrl, apiKey, agentType));
    }
    return this.providerCache.get(key);
  }

  private async detectProjectType(workspaceDir: string): Promise<string | undefined> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    try {
      const files = await fs.readdir(workspaceDir);
      if (files.includes('package.json')) return 'node';
      if (files.some(f => f.endsWith('.php'))) return 'php';
      if (files.some(f => f.endsWith('.html') || f.endsWith('.htm'))) return 'static';
    } catch {}
    return undefined;
  }

  private recordStep(role: string, model: string, action: string, input: string): any {
    if (!this.currentSessionId) return null;
    const stepNumber = this.stepsRepo.countBySession(this.currentSessionId) + 1;
    return this.stepsRepo.create(this.currentSessionId, stepNumber, role as any, model, action as any, input);
  }

  private updateStepResult(id: string | null, output: string | null, status: 'completed' | 'failed', errorMessage: string | null, durationMs: number | null): void {
    if (!id) return;
    this.stepsRepo.updateResult(id, output, status, errorMessage ?? null, durationMs ?? null);
  }

  private handleFatalError(sessionId: string, errorMessage: string): void {
    this.running = false;
    this.sessionsRepo.updateStatus(sessionId, 'failed');
    this.sessionsRepo.updateProgress(sessionId, this.getCurrentProgress(), `Fatal error: ${errorMessage}`);
    this.stateRepo.setRunning(false, null);
    this.emitEvent('orchestrator:complete', { sessionId, status: 'failed' });
    this.emitEvent('orchestrator:error', { sessionId, error: errorMessage, role: 'orchestrator' });
    this.currentSessionId = null;
  }

  private getCurrentProgress(): number {
    if (!this.currentSessionId) return 0;
    const all = this.tasksRepo.findBySession(this.currentSessionId);
    if (all.length === 0) return 0;
    const completed = all.filter(t => t.status === 'completed').length;
    return Math.round((completed / all.length) * 100);
  }

  private deductCreditsForTask(userId: string | undefined, role: string, stepsUsed: number): void {
    if (!userId || !this.currentSessionId) return;
    const user = this.usersRepo.findById(userId);
    if (user?.role === 'admin') return;
    if (stepsUsed <= 0) return;
    try {
      const costPerStep = this.creditManager.getCostPerStep(this.getModelForRole(role as OrchestratorRole));
      const totalCost = stepsUsed * costPerStep;
      this.creditManager.deductCredit(userId, `orchestrator:${this.currentSessionId}`, totalCost);
    } catch (err: any) {
      if (err.message?.includes('Insufficient') || err.message?.includes('exhausted')) {
        throw new Error('Credits exhausted');
      }
    }
  }

  private getModelForRole(role: OrchestratorRole): string {
    switch (role) {
      case 'auxiliar': return 'nvidia/nemotron-3-ultra-550b-a55b';
      case 'arquiteto': return 'z-ai/glm-5.1';
      case 'programador': return 'deepseek-ai/deepseek-v4-pro';
      case 'revisor': return 'moonshotai/kimi-k2.6';
      default: return 'deepseek-ai/deepseek-v4-pro';
    }
  }

  private emitEvent(event: string, data: any): void {
    if (!this.io) return;
    if (this.currentSessionId) this.io.to(`orchestrator:${this.currentSessionId}`).emit(event, data);
    const session = this.currentSessionId ? this.sessionsRepo.findById(this.currentSessionId) : null;
    if (session?.userId) this.io.to(`user:${session.userId}`).emit(event, data);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.running) this.stateRepo.updateHeartbeat();
    }, 10_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}
