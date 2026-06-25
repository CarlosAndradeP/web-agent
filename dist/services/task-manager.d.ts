import type Database from 'better-sqlite3';
import type { Task } from '../types/index.js';
import { type ProjectInfo } from '../agent/index.js';
import { CreditManager } from '../services/credit-manager.js';
import type { ApprovalManager } from './approval-manager.js';
import type { Server } from 'socket.io';
export interface StreamEvent {
    type: 'text-delta' | 'tool-call' | 'tool-result' | 'step-start' | 'step-end' | 'finish' | 'error' | 'credits-exhausted';
    taskId: string;
    [key: string]: unknown;
}
export declare class TaskManager {
    private db;
    private tasksRepo;
    private configRepo;
    private creditManager;
    private approvalManager;
    private io;
    private activeControllers;
    private taskProjectInfo;
    private taskUserIds;
    constructor(db: Database.Database, creditManager: CreditManager, approvalManager?: ApprovalManager);
    private emitToTaskUser;
    private insertStep;
    setIo(io: Server): void;
    createTask(sessionId: string, description: string, model: string | null, maxSteps?: number, userId?: string, workspaceDir?: string, projectInfo?: ProjectInfo): Task;
    runTask(taskId: string): Promise<void>;
    streamTask(taskId: string): Promise<AsyncIterable<StreamEvent>>;
    cancelTask(taskId: string): void;
    getTasks(): Task[];
    getTask(id: string): Task | undefined;
    getTasksBySession(sessionId: string): Task[];
}
//# sourceMappingURL=task-manager.d.ts.map