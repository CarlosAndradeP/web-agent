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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }
}
