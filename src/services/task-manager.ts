import type Database from 'better-sqlite3';
import type { Task, AgentStep } from '../types/index.js';
import type { ModelMessage } from '@ai-sdk/provider-utils';
import { TasksRepository } from '../db/repositories/tasks.js';
import { createAgent, type ProjectInfo } from '../agent/index.js';
import { ConfigRepository } from '../db/repositories/config.js';
import { CreditManager } from '../services/credit-manager.js';
import type { ApprovalManager } from './approval-manager.js';
import { createLogger } from '../services/logger.js';
import type { Server } from 'socket.io';
import { v4 as uuid } from 'uuid';

const log = createLogger('TaskManager');

export interface StreamEvent {
  type: 'text-delta' | 'tool-call' | 'tool-result' | 'step-start' | 'step-end' | 'finish' | 'error' | 'credits-exhausted';
  taskId: string;
  [key: string]: unknown;
}

export class TaskManager {
  private tasksRepo: TasksRepository;
  private configRepo: ConfigRepository;
  private creditManager: CreditManager;
  private approvalManager: ApprovalManager | null;
  private io: Server | null = null;
  private activeControllers = new Map<string, AbortController>();
  private taskProjectInfo = new Map<string, ProjectInfo>();
  private taskUserIds = new Map<string, string>();
  private taskConversationContext = new Map<string, Array<ModelMessage>>();
  private taskWorkspaceProfiles = new Map<string, 'development' | 'word'>();

  constructor(private db: Database.Database, creditManager: CreditManager, approvalManager?: ApprovalManager) {
    this.tasksRepo = new TasksRepository(db);
    this.configRepo = new ConfigRepository(db);
    this.creditManager = creditManager;
    this.approvalManager = approvalManager ?? null;
  }

  private emitToTaskUser(taskId: string, event: string, data: any): void {
    if (!this.io) return;
    const userId = this.taskUserIds.get(taskId);
    const emitter = userId ? this.io.to(`user:${userId}`) : this.io;
    emitter.emit(event, data);
  }

  private insertStep(taskId: string, stepNumber: number, toolName: string | null, toolInput: string | null, toolOutput: string | null, durationMs: number | null): void {
    const id = uuid();
    const now = new Date().toISOString();
    try {
      this.db.prepare(
        'INSERT INTO agent_steps (id, task_id, step_number, tool_name, tool_input, tool_output, reasoning, duration_ms, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)'
      ).run(id, taskId, stepNumber, toolName, toolInput, toolOutput, durationMs, 'success', now);
    } catch (err: any) {
      log.warn('Failed to insert agent step', { taskId, stepNumber, error: err.message });
    }
  }

  setIo(io: Server): void {
    this.io = io;
    log.info('Socket.IO instance set');
  }

  createTask(sessionId: string, description: string, model: string | null, maxSteps?: number, userId?: string, workspaceDir?: string, projectInfo?: ProjectInfo, conversationContext?: Array<ModelMessage>, workspaceProfile: 'development' | 'word' = 'development'): Task {
    log.info('Creating task', { sessionId, description: description.slice(0, 100), model, maxSteps, userId, contextLength: conversationContext?.length });
    const task = this.tasksRepo.create(sessionId, description, model, maxSteps);
    if (userId) {
      this.taskUserIds.set(task.id, userId);
      try {
        this.db.prepare('UPDATE tasks SET user_id = ?, workspace_dir = ? WHERE id = ?').run(userId, workspaceDir ?? null, task.id);
      } catch (err: any) {
        log.warn('Failed to set task user_id', { taskId: task.id, error: err.message });
      }
    }
    if (projectInfo) {
      this.taskProjectInfo.set(task.id, projectInfo);
    }
    if (conversationContext && conversationContext.length > 0) {
      this.taskConversationContext.set(task.id, conversationContext);
    }
    this.taskWorkspaceProfiles.set(task.id, workspaceProfile);
    if (this.io) {
      const room = userId ? `user:${userId}` : undefined;
      const emitter = room ? this.io.to(room) : this.io;
      emitter.emit('task:created', { task });
    }
    log.info('Task created', { taskId: task.id, status: task.status });
    return task;
  }

  async runTask(taskId: string): Promise<void> {
    const task = this.tasksRepo.findById(taskId);
    if (!task) {
      log.error('Task not found', { taskId });
      throw new Error('Task not found');
    }

    this.tasksRepo.updateStatus(taskId, 'running');
    const appConfig = this.configRepo.getAll();
    const model = task.model ?? appConfig.defaultModel;
    const workspaceDir = task.workspaceDir ?? appConfig.workspaceDir;
    const userId = task.userId;
    const projectInfo = this.taskProjectInfo.get(taskId) ?? undefined;
    const conversationContext = this.taskConversationContext.get(taskId) ?? undefined;
    const workspaceProfile = this.taskWorkspaceProfiles.get(taskId) ?? 'development';

    const abortController = new AbortController();
    this.activeControllers.set(taskId, abortController);

    log.info('Running task (non-streaming)', { taskId, model, maxSteps: task.maxSteps, hasContext: !!conversationContext });

    try {
      const { agent, abortSignal } = createAgent({
        model,
        maxSteps: task.maxSteps,
        sessionId: task.sessionId,
        workspaceDir,
        approvalMode: appConfig.approvalMode,
        approvalTools: appConfig.approvalTools,
        apiBaseUrl: appConfig.apiBaseUrl,
        apiKey: appConfig.apiKey,
        agentType: appConfig.agentType,
        abortSignal: abortController.signal,
        projectInfo,
        approvalManager: this.approvalManager ?? undefined,
        userId,
        conversationContext,
        workspaceProfile,
      });

      const self = this;
      const creditManager = this.creditManager;
      const costPerStep = creditManager.getCostPerStep(model);

      const stepCallback = async ({ stepNumber, toolCalls, toolResults }: any) => {
        self.tasksRepo.incrementStep(taskId);
        if (this.io) {
          this.emitToTaskUser(taskId, 'task:step', { taskId, stepNumber, toolCalls: toolCalls?.map((tc: any) => tc.toolName) });
        }
        if (userId && toolResults?.length) {
          try {
            creditManager.deductCredit(userId, taskId, costPerStep);
          } catch (creditErr: any) {
            log.warn('Credit deduction failed, aborting task', { taskId, error: creditErr.message });
            abortController.abort();
          }
        }
      };

      // Use messages array if we have conversation context, otherwise fall back to single prompt
      const result = conversationContext && conversationContext.length > 0
        ? await agent.generate({ messages: conversationContext, abortSignal, onStepFinish: stepCallback })
        : await agent.generate({ prompt: task.description, abortSignal, onStepFinish: stepCallback });

      const text = result.text ?? 'Task completed';
      this.tasksRepo.updateStatus(taskId, 'completed', text);
      this.emitToTaskUser(taskId, 'task:completed', { taskId, result: text });
      log.info('Task completed', { taskId, resultLength: text.length });
    } catch (err: any) {
      this.tasksRepo.updateStatus(taskId, 'failed', null, err.message);
      this.emitToTaskUser(taskId, 'task:failed', { taskId, error: err.message });
      log.error('Task failed', { taskId, error: err.message, stack: err.stack });
    } finally {
      this.activeControllers.delete(taskId);
      this.taskProjectInfo.delete(taskId);
      this.taskUserIds.delete(taskId);
      this.taskConversationContext.delete(taskId);
      this.taskWorkspaceProfiles.delete(taskId);
    }
  }

  async streamTask(taskId: string): Promise<AsyncIterable<StreamEvent>> {
    const task = this.tasksRepo.findById(taskId);
    if (!task) {
      log.error('Task not found for streaming', { taskId });
      throw new Error('Task not found');
    }

    this.tasksRepo.updateStatus(taskId, 'running');
    const appConfig = this.configRepo.getAll();
    const model = task.model ?? appConfig.defaultModel;
    const workspaceDir = task.workspaceDir ?? appConfig.workspaceDir;
    const userId = task.userId;
    const projectInfo = this.taskProjectInfo.get(taskId) ?? undefined;
    const conversationContext = this.taskConversationContext.get(taskId) ?? undefined;
    const workspaceProfile = this.taskWorkspaceProfiles.get(taskId) ?? 'development';

    const abortController = new AbortController();
    this.activeControllers.set(taskId, abortController);

    log.info('Streaming task', { taskId, model, maxSteps: task.maxSteps, sessionId: task.sessionId, hasContext: !!conversationContext });

    const { agent, abortSignal } = createAgent({
      model,
      maxSteps: task.maxSteps,
      sessionId: task.sessionId,
      workspaceDir,
      approvalMode: appConfig.approvalMode,
      approvalTools: appConfig.approvalTools,
      apiBaseUrl: appConfig.apiBaseUrl,
      apiKey: appConfig.apiKey,
      agentType: appConfig.agentType,
      abortSignal: abortController.signal,
      projectInfo,
      approvalManager: this.approvalManager ?? undefined,
      userId,
      conversationContext,
      workspaceProfile,
    });

    log.info('Agent created, calling stream()...', { taskId, model });

    const costPerStep = this.creditManager.getCostPerStep(model);

    const stepCallback = async ({ stepNumber, toolCalls, toolResults }: any) => {
      this.tasksRepo.incrementStep(taskId);
      this.emitToTaskUser(taskId, 'task:step', { taskId, stepNumber, toolCalls: toolCalls?.map((tc: any) => tc.toolName) });
      if (userId && toolResults?.length) {
        try {
          this.creditManager.deductCredit(userId, taskId, costPerStep);
        } catch (creditErr: any) {
          log.warn('Credit deduction failed, aborting task', { taskId, error: creditErr.message });
          abortController.abort();
        }
      }
    };

    try {
      // Use messages array if we have conversation context, otherwise fall back to single prompt
      const streamResult = conversationContext && conversationContext.length > 0
        ? await agent.stream({ messages: conversationContext, abortSignal, onStepFinish: stepCallback })
        : await agent.stream({ prompt: task.description, abortSignal, onStepFinish: stepCallback });

      log.info('Agent stream obtained, returning fullStream', { taskId });

      const tasksRepo = this.tasksRepo;
      const activeControllers = this.activeControllers;
      const taskProjectInfo = this.taskProjectInfo;
      const taskUserIds = this.taskUserIds;
      const taskConversationContext = this.taskConversationContext;
      const taskWorkspaceProfiles = this.taskWorkspaceProfiles;
      const insertStep = this.insertStep.bind(this);
      const emitToTaskUser = this.emitToTaskUser.bind(this);

      const fullStream = streamResult.fullStream;

      async function* eventStream(): AsyncIterableIterator<StreamEvent> {
        let stepNumber = 0;
        let stepStartTime = Date.now();
        const pendingTools = new Map<string, { toolName: string; toolInput: string; startedAt: number }>();

        try {
          for await (const chunk of fullStream) {
            // Check if task was cancelled between chunks
            if (abortSignal?.aborted) {
              log.info('Stream aborted by signal', { taskId });
              break;
            }

            const chunkType = chunk.type as string;

            if (chunkType === 'text-delta') {
              const text = (chunk as any).text ?? '';
              if (text) {
                yield { type: 'text-delta' as const, taskId, content: text };
              }
            } else if (chunkType === 'tool-call') {
              const toolCallId = (chunk as any).toolCallId;
              const toolName = (chunk as any).toolName;
              const toolInput = JSON.stringify((chunk as any).input ?? {}).slice(0, 5000);
              pendingTools.set(toolCallId, { toolName, toolInput, startedAt: Date.now() });
              yield {
                type: 'tool-call' as const,
                taskId,
                toolName,
                toolCallId,
                input: (chunk as any).input,
              };
            } else if (chunkType === 'tool-result') {
              const toolCallId = (chunk as any).toolCallId;
              const pendingTool = pendingTools.get(toolCallId);
              const durationMs = Date.now() - (pendingTool?.startedAt ?? stepStartTime);
              stepNumber++;
              const output = JSON.stringify((chunk as any).output ?? {}).slice(0, 5000);
              insertStep(taskId, stepNumber, pendingTool?.toolName ?? null, pendingTool?.toolInput ?? null, output, durationMs);
              yield {
                type: 'tool-result' as const,
                taskId,
                toolName: pendingTool?.toolName ?? 'unknown',
                toolCallId,
                result: (chunk as any).output,
                stepNumber,
                durationMs,
              };
              pendingTools.delete(toolCallId);
              stepStartTime = Date.now();
            } else if (chunkType === 'start-step') {
              stepStartTime = Date.now();
              yield {
                type: 'step-start' as const,
                taskId,
                stepNumber: stepNumber + 1,
              };
            } else if (chunkType === 'finish-step') {
              yield {
                type: 'step-end' as const,
                taskId,
                stepNumber,
              };
            } else if (chunkType === 'finish' || chunkType === 'error' || chunkType === 'abort') {
              // handled below
            }
          }

          // If the stream exited via abort (not natural finish), mark the task
          // cancelled rather than completed. Otherwise the cancelTask call and
          // the generator finally race, and the status ends up 'completed' for a
          // task the user explicitly stopped.
          if (abortSignal?.aborted) {
            const wasAlreadyCancelled = tasksRepo.findById(taskId)?.status === 'cancelled';
            tasksRepo.updateStatus(taskId, 'cancelled');
            if (!wasAlreadyCancelled) emitToTaskUser(taskId, 'task:cancelled', { taskId });
            log.info('Stream cancelled by signal', { taskId, totalSteps: stepNumber });
          } else {
            tasksRepo.updateStatus(taskId, 'completed');
            emitToTaskUser(taskId, 'task:completed', { taskId });
            log.info('Stream completed', { taskId, totalSteps: stepNumber });
          }
        } catch (err: any) {
          tasksRepo.updateStatus(taskId, 'failed', null, err.message);
          emitToTaskUser(taskId, 'task:failed', { taskId, error: err.message });
          log.error('Stream error', { taskId, error: err.message, stack: err.stack });
          throw err;
        } finally {
          activeControllers.delete(taskId);
          taskProjectInfo.delete(taskId);
          taskUserIds.delete(taskId);
          taskConversationContext.delete(taskId);
          taskWorkspaceProfiles.delete(taskId);
        }
      }

      return eventStream();
    } catch (err: any) {
      this.activeControllers.delete(taskId);
      this.taskProjectInfo.delete(taskId);
      this.taskUserIds.delete(taskId);
      this.taskConversationContext.delete(taskId);
      this.taskWorkspaceProfiles.delete(taskId);
      this.tasksRepo.updateStatus(taskId, 'failed', null, err.message);
      this.emitToTaskUser(taskId, 'task:failed', { taskId, error: err.message });
      log.error('Failed to create agent stream', { taskId, error: err.message, stack: err.stack });
      throw err;
    }
  }

  cancelTask(taskId: string): void {
    log.info('Canceling task', { taskId });
    const controller = this.activeControllers.get(taskId);
    if (controller) {
      const wasAlreadyCancelled = this.tasksRepo.findById(taskId)?.status === 'cancelled';
      controller.abort();
      // Emit BEFORE deleting taskUserIds: emitToTaskUser looks up the userId
      // entry to scope the broadcast to the owner's socket room. Deleting
      // first would make the emit fall back to a global broadcast, leaking the
      // event to every connected user.
      this.tasksRepo.updateStatus(taskId, 'cancelled');
      if (!wasAlreadyCancelled) this.emitToTaskUser(taskId, 'task:cancelled', { taskId });
      log.info('Task canceled', { taskId });
    } else {
      log.warn('No active controller for task cancel', { taskId });
    }
  }

  getTasks(): Task[] {
    return this.tasksRepo.list();
  }

  getTask(id: string): Task | undefined {
    return this.tasksRepo.findById(id);
  }

  getTasksBySession(sessionId: string): Task[] {
    return this.tasksRepo.findBySession(sessionId);
  }
}
