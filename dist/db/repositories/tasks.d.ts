import type Database from 'better-sqlite3';
import type { Task, TaskStatus } from '../../types/index.js';
export declare class TasksRepository {
    private db;
    constructor(db: Database.Database);
    create(sessionId: string, description: string, model: string | null, maxSteps?: number): Task;
    findById(id: string): Task | undefined;
    findBySession(sessionId: string): Task[];
    list(): Task[];
    updateStatus(id: string, status: TaskStatus, result?: string | null, error?: string | null): void;
    incrementStep(id: string): void;
    private mapRow;
}
//# sourceMappingURL=tasks.d.ts.map