import { v4 as uuid } from 'uuid';
import type Database from 'better-sqlite3';
import type { Session } from '../../types/index.js';

export class SessionsRepository {
  constructor(private db: Database.Database) {}

  create(name: string, model: string): Session {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO sessions (id, name, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, model, now, now);
    return { id, name, model, createdAt: now, updatedAt: now };
  }

  findById(id: string): Session | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      model: row.model,
      userId: row.user_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  list(): Session[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all() as any[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      model: row.model,
      userId: row.user_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  findByUserId(userId: string, limit: number = 50, offset: number = 0): Session[] {
    const rows = this.db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(userId, limit, offset) as any[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      model: row.model,
      userId: row.user_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  countByUserId(userId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?').get(userId) as any;
    return row.count;
  }

  listPaginated(limit: number = 50, offset: number = 0): Session[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as any[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      model: row.model,
      userId: row.user_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as any;
    return row.count;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  updateSummary(sessionId: string, summaryText: string): void {
    this.db.prepare('UPDATE sessions SET summary_text = ?, updated_at = ? WHERE id = ?')
      .run(summaryText, new Date().toISOString(), sessionId);
  }

  getSummary(sessionId: string): string | null {
    const row = this.db.prepare('SELECT summary_text FROM sessions WHERE id = ?').get(sessionId) as any;
    return row?.summary_text ?? null;
  }
}
