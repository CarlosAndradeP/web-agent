import { v4 as uuid } from 'uuid';
import type Database from 'better-sqlite3';
import type { WordWorkspace } from '../../types/index.js';

function mapRow(row: any): WordWorkspace {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class WordWorkspacesRepository {
  constructor(private db: Database.Database) {}

  findByUserId(userId: string): WordWorkspace | undefined {
    const row = this.db.prepare('SELECT * FROM word_workspaces WHERE user_id = ?').get(userId);
    return row ? mapRow(row) : undefined;
  }

  findBySessionId(sessionId: string): WordWorkspace | undefined {
    const row = this.db.prepare('SELECT * FROM word_workspaces WHERE session_id = ?').get(sessionId);
    return row ? mapRow(row) : undefined;
  }

  create(userId: string, sessionId: string, model: string): WordWorkspace {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO word_workspaces (id, user_id, session_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, userId, sessionId, model, now, now);
    return { id, userId, sessionId, model, createdAt: now, updatedAt: now };
  }

  updateModel(userId: string, model: string): WordWorkspace | undefined {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE word_workspaces SET model = ?, updated_at = ? WHERE user_id = ?').run(model, now, userId);
    return this.findByUserId(userId);
  }
}
