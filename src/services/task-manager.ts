import type Database from 'better-sqlite3';
import type { Task, AgentStep } from '../types/index.js';
import { TasksRepository } from '../db/repositories/tasks.js';
import { createAgent } from '../agent/index.js';
import { ConfigRepository } from '../db/repositories/config.js';
import { CreditManager } from '../services/credit-manager.js';
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
  private io: Server | null = null;
  private activeControllers = new Map<string, AbortController>();

  constructor(private db: Database.Database, creditManager: CreditManager) {
    this.tasksRepo = new TasksRepository(db);
    this.configRepo = new ConfigRepository(db);
    this.creditManager = creditManager;
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

  createTask(sessionId: string, description: string, model: string | null, maxSteps?: number, userId?: string, workspaceDir?: string): Task {
    log.info('Creating task', { sessionId, description: description.slice(0, 100), model, maxSteps, userId });
    const task = this.tasksRepo.create(sessionId, description, model, maxSteps);
    if (userId) {
      try {
        this.db.prepare('UPDATE tasks SET user_id = ?, workspace_dir = ? WHERE id = ?').run(userId, workspaceDir ?? null, task.id);
      } catch (err: any) {
        log.warn('Failed to set task user_id', { taskId: task.id, error: err.message });
      }
    }
    if (this.io) {
      this.io.emit('task:created', { task });
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
    const workspaceDir = (task as any).workspace_dir ?? appConfig.workspaceDir;
    const userId = (task as any).user_id;

    const abortController = new AbortController();
    this.activeControllers.set(taskId, abortController);

    log.info('Running task (non-streaming)', { taskId, model, maxSteps: task.maxSteps });

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
      });

      const self = this;
      const creditManager = this.creditManager;

      const result = await agent.generate({
        prompt: task.description,
        abortSignal,
        onStepFinish: async ({ stepNumber, toolCalls, toolResults }) => {
          self.tasksRepo.incrementStep(taskId);
          if (this.io) {
            this.io.emit('task:step', { taskId, stepNumber, toolCalls: toolCalls?.map((tc: any) => tc.toolName) });
          }
          if (userId && toolResults?.length) {
            try {
              creditManager.deductCredit(userId, taskId);
            } catch (creditErr: any) {
              log.warn('Credit deduction failed, aborting task', { taskId, error: creditErr.message });
              abortController.abort();
            }
          }
          for (const tr of toolResults ?? []) {
            const tc = toolCalls?.find((t: any) => t.toolCallId === (tr as any).toolCallId);
            self.insertStep(
              taskId, stepNumber,
              tc?.toolName ?? null,
              tc ? JSON.stringify((tc as any).input ?? {}).slice(0, 5000) : null,
              JSON.stringify((tr as any).output ?? (tr as any)).slice(0, 5000),
              null
            );
          }
        },
      });

      const text = result.text ?? 'Task completed';
      this.tasksRepo.updateStatus(taskId, 'completed', text);
      if (this.io) {
        this.io.emit('task:completed', { taskId, result: text });
      }
      log.info('Task completed', { taskId, resultLength: text.length });
    } catch (err: any) {
      this.tasksRepo.updateStatus(taskId, 'failed', null, err.message);
      if (this.io) {
        this.io.emit('task:failed', { taskId, error: err.message });
      }
      log.error('Task failed', { taskId, error: err.message, stack: err.stack });
    } finally {
      this.activeControllers.delete(taskId);
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
    const workspaceDir = (task as any).workspace_dir ?? appConfig.workspaceDir;
    const userId = (task as any).user_id;

    const abortController = new AbortController();
    this.activeControllers.set(taskId, abortController);

    log.info('Streaming task', { taskId, model, maxSteps: task.maxSteps, sessionId: task.sessionId });

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
    });

    log.info('Agent created, calling stream()...', { taskId, model });

    try {
      const streamResult = await agent.stream({
        prompt: task.description,
        abortSignal,
        onStepFinish: async ({ stepNumber, toolCalls, toolResults }) => {
          this.tasksRepo.incrementStep(taskId);
          if (this.io) {
            this.io.emit('task:step', { taskId, stepNumber, toolCalls: toolCalls?.map((tc: any) => tc.toolName) });
          }
          if (userId && toolResults?.length) {
            try {
              this.creditManager.deductCredit(userId, taskId);
            } catch (creditErr: any) {
              log.warn('Credit deduction failed, aborting task', { taskId, error: creditErr.message });
              abortController.abort();
            }
          }
          for (const tr of toolResults ?? []) {
            const tc = toolCalls?.find((t: any) => t.toolCallId === (tr as any).toolCallId);
            this.insertStep(
              taskId, stepNumber,
              tc?.toolName ?? null,
              tc ? JSON.stringify((tc as any).input ?? {}).slice(0, 5000) : null,
              JSON.stringify((tr as any).output ?? (tr as any)).slice(0, 5000),
              null
            );
          }
        },
      });

      log.info('Agent stream obtained, returning fullStream', { taskId });

      const tasksRepo = this.tasksRepo;
      const io = this.io;
      const activeControllers = this.activeControllers;
      const insertStep = this.insertStep.bind(this);

      const fullStream = streamResult.fullStream;

      async function* eventStream(): AsyncIterableIterator<StreamEvent> {
        let stepNumber = 0;
        let toolName: string | null = null;
        let toolInput: string | null = null;
        let stepStartTime = Date.now();

        try {
          for await (const chunk of fullStream) {
            const chunkType = chunk.type as string;

            if (chunkType === 'text-delta') {
              const text = (chunk as any).text ?? '';
              if (text) {
                yield { type: 'text-delta' as const, taskId, content: text };
              }
            } else if (chunkType === 'tool-call') {
              toolName = (chunk as any).toolName;
              toolInput = JSON.stringify((chunk as any).input ?? {}).slice(0, 5000);
              yield {
                type: 'tool-call' as const,
                taskId,
                toolName,
                toolCallId: (chunk as any).toolCallId,
                input: (chunk as any).input,
              };
            } else if (chunkType === 'tool-result') {
              const durationMs = Date.now() - stepStartTime;
              stepNumber++;
              const output = JSON.stringify((chunk as any).output ?? {}).slice(0, 5000);
              insertStep(taskId, stepNumber, toolName, toolInput, output, durationMs);
              yield {
                type: 'tool-result' as const,
                taskId,
                toolName: toolName ?? 'unknown',
                toolCallId: (chunk as any).toolCallId,
                result: (chunk as any).output,
                stepNumber,
                durationMs,
              };
              toolName = null;
              toolInput = null;
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

          tasksRepo.updateStatus(taskId, 'completed');
          if (io) {
            io.emit('task:completed', { taskId });
          }
          log.info('Stream completed', { taskId, totalSteps: stepNumber });
        } catch (err: any) {
          tasksRepo.updateStatus(taskId, 'failed', null, err.message);
          if (io) {
            io.emit('task:failed', { taskId, error: err.message });
          }
          log.error('Stream error', { taskId, error: err.message, stack: err.stack });
          yield { type: 'error' as const, taskId, error: err.message };
          throw err;
        } finally {
          activeControllers.delete(taskId);
        }
      }

      return eventStream();
    } catch (err: any) {
      this.activeControllers.delete(taskId);
      this.tasksRepo.updateStatus(taskId, 'failed', null, err.message);
      if (this.io) {
        this.io.emit('task:failed', { taskId, error: err.message });
      }
      log.error('Failed to create agent stream', { taskId, error: err.message, stack: err.stack });
      throw err;
    }
  }

  cancelTask(taskId: string): void {
    log.info('Canceling task', { taskId });
    const controller = this.activeControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.tasksRepo.updateStatus(taskId, 'cancelled');
      this.activeControllers.delete(taskId);
      if (this.io) {
        this.io.emit('task:cancelled', { taskId });
      }
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
