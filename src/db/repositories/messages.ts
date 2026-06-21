import { v4 as uuid } from 'uuid';
import type Database from 'better-sqlite3';
import type { Message } from '../../types/index.js';

export class MessagesRepository {
  constructor(private db: Database.Database) {}

  create(sessionId: string, role: string, content: string | null, toolCalls: string | null = null, toolCallId: string | null = null, stepNumber: number | null = null): Message {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO messages (id, session_id, role, content, tool_calls, tool_call_id, step_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, sessionId, role, content, toolCalls, toolCallId, stepNumber, now);
    return { id, sessionId, role: role as any, content, toolCalls, toolCallId, stepNumber, createdAt: now };
  }

  findBySession(sessionId: string): Message[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as any[];
    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls,
      toolCallId: row.tool_call_id,
      stepNumber: row.step_number,
      createdAt: row.created_at,
    }));
  }
}
