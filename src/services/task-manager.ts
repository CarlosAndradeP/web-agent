import type Database from 'better-sqlite3';
import type { Task, AgentStep } from '../types/index.js';
import { TasksRepository } from '../db/repositories/tasks.js';
import { createAgent } from '../agent/index.js';
import { ConfigRepository } from '../db/repositories/config.js';
import type { Server } from 'socket.io';

export class TaskManager {
  private tasksRepo: TasksRepository;
  private configRepo: ConfigRepository;
  private io: Server | null = null;
  private activeControllers = new Map<string, AbortController>();

  constructor(private db: Database.Database) {
    this.tasksRepo = new TasksRepository(db);
    this.configRepo = new ConfigRepository(db);
  }

  setIo(io: Server): void {
    this.io = io;
  }

  createTask(sessionId: string, description: string, model: string | null, maxSteps?: number): Task {
    const task = this.tasksRepo.create(sessionId, description, model, maxSteps);
    if (this.io) {
      this.io.emit('task:created', { task });
    }
    return task;
  }

  async runTask(taskId: string): Promise<void> {
    const task = this.tasksRepo.findById(taskId);
    if (!task) throw new Error('Task not found');

    this.tasksRepo.updateStatus(taskId, 'running');
    const appConfig = this.configRepo.getAll();
    const model = task.model ?? appConfig.defaultModel;

    const abortController = new AbortController();
    this.activeControllers.set(taskId, abortController);

    try {
      const agent = createAgent({
        model,
        maxSteps: task.maxSteps,
        sessionId: task.sessionId,
        workspaceDir: appConfig.workspaceDir,
        approvalMode: appConfig.approvalMode,
        approvalTools: appConfig.approvalTools,
        apiBaseUrl: appConfig.apiBaseUrl,
        apiKey: appConfig.apiKey,
        onStep: (step) => {
          if (this.io) {
            this.io.emit('task:step', { taskId, step });
          }
        },
      });

      const result = await agent.generate({
        prompt: task.description,
      });

      const text = result.text ?? 'Task completed';
      this.tasksRepo.updateStatus(taskId, 'completed', text);
      if (this.io) {
        this.io.emit('task:completed', { taskId, result: text });
      }
    } catch (err: any) {
      this.tasksRepo.updateStatus(taskId, 'failed', null, err.message);
      if (this.io) {
        this.io.emit('task:failed', { taskId, error: err.message });
      }
    } finally {
      this.activeControllers.delete(taskId);
    }
  }

  async streamTask(taskId: string): Promise<AsyncIterable<string>> {
    const task = this.tasksRepo.findById(taskId);
    if (!task) throw new Error('Task not found');

    this.tasksRepo.updateStatus(taskId, 'running');
    const appConfig = this.configRepo.getAll();
    const model = task.model ?? appConfig.defaultModel;

    const agent = createAgent({
      model,
      maxSteps: task.maxSteps,
      sessionId: task.sessionId,
      workspaceDir: appConfig.workspaceDir,
      approvalMode: appConfig.approvalMode,
      approvalTools: appConfig.approvalTools,
      apiBaseUrl: appConfig.apiBaseUrl,
      apiKey: appConfig.apiKey,
      onStep: (step) => {
        if (this.io) {
          this.io.emit('task:step', { taskId, step });
        }
        this.tasksRepo.incrementStep(taskId);
      },
    });

    const streamResult = await agent.stream({
      prompt: task.description,
    });

    return streamResult.textStream;
  }

  cancelTask(taskId: string): void {
    const controller = this.activeControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.tasksRepo.updateStatus(taskId, 'cancelled');
      this.activeControllers.delete(taskId);
      if (this.io) {
        this.io.emit('task:cancelled', { taskId });
      }
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
