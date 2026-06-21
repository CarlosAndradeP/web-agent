import { v4 as uuid } from 'uuid';
import type Database from 'better-sqlite3';
import type { Task, TaskStatus } from '../../types/index.js';

export class TasksRepository {
  constructor(private db: Database.Database) {}

  create(sessionId: string, description: string, model: string | null, maxSteps: number = 100): Task {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO tasks (id, session_id, description, status, model, max_steps, current_step, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, sessionId, description, 'pending', model, maxSteps, 0, now, now);
    return {
      id, sessionId, description, status: 'pending', model, maxSteps, currentStep: 0, result: null, error: null, createdAt: now, updatedAt: now,
    };
  }

  findById(id: string): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return this.mapRow(row);
  }

  findBySession(sessionId: string): Task[] {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as any[];
    return rows.map(this.mapRow);
  }

  list(): Task[] {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as any[];
    return rows.map(this.mapRow);
  }

  updateStatus(id: string, status: TaskStatus, result: string | null = null, error: string | null = null): void {
    const now = new Date().toISOString();
    this.db.prepare(
      'UPDATE tasks SET status = ?, result = COALESCE(?, result), error = COALESCE(?, error), updated_at = ? WHERE id = ?'
    ).run(status, result, error, now, id);
  }

  incrementStep(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      'UPDATE tasks SET current_step = current_step + 1, updated_at = ? WHERE id = ?'
    ).run(now, id);
  }

  private mapRow(row: any): Task {
    return {
      id: row.id,
      sessionId: row.session_id,
      description: row.description,
      status: row.status,
      model: row.model,
      maxSteps: row.max_steps,
      currentStep: row.current_step,
      result: row.result,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
