import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { createLogger } from '../../services/logger.js';

const log = createLogger('CreditsRepository');

export interface CreditTransaction {
  id: string;
  userId: string;
  amount: number;
  balanceAfter: number;
  type: 'purchase' | 'consumption' | 'refund' | 'bonus';
  description: string | null;
  taskId: string | null;
  createdAt: string;
}

export class CreditsRepository {
  constructor(private db: Database.Database) {}

  deduct(userId: string, amount: number, type: CreditTransaction['type'], description?: string, taskId?: string): CreditTransaction {
    const id = uuid();
    const now = new Date().toISOString();

    const user = this.db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as any;
    if (!user) throw new Error('User not found');
    if (user.credits < amount) throw new Error('Insufficient credits');

    const newBalance = user.credits - amount;
    this.db.prepare('UPDATE users SET credits = ?, updated_at = ? WHERE id = ?').run(newBalance, now, userId);
    this.db.prepare(
      'INSERT INTO credit_transactions (id, user_id, amount, balance_after, type, description, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, userId, -amount, newBalance, type, description ?? null, taskId ?? null, now);

    log.info('Credits deducted', { userId, amount, newBalance, type });
    return {
      id,
      userId,
      amount: -amount,
      balanceAfter: newBalance,
      type,
      description: description ?? null,
      taskId: taskId ?? null,
      createdAt: now,
    };
  }

  add(userId: string, amount: number, type: CreditTransaction['type'], description?: string): CreditTransaction {
    const id = uuid();
    const now = new Date().toISOString();

    const user = this.db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as any;
    if (!user) throw new Error('User not found');

    const newBalance = user.credits + amount;
    this.db.prepare('UPDATE users SET credits = ?, updated_at = ? WHERE id = ?').run(newBalance, now, userId);
    this.db.prepare(
      'INSERT INTO credit_transactions (id, user_id, amount, balance_after, type, description, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, userId, amount, newBalance, type, description ?? null, null, now);

    log.info('Credits added', { userId, amount, newBalance, type });
    return {
      id,
      userId,
      amount,
      balanceAfter: newBalance,
      type,
      description: description ?? null,
      taskId: null,
      createdAt: now,
    };
  }

  getBalance(userId: string): number {
    const row = this.db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as any;
    return row ? row.credits : 0;
  }

  getHistory(userId: string, limit = 50, offset = 0): CreditTransaction[] {
    const rows = this.db.prepare(
      'SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(userId, limit, offset) as any[];
    return rows.map(r => this.mapRow(r));
  }

  private mapRow(row: any): CreditTransaction {
    return {
      id: row.id,
      userId: row.user_id,
      amount: row.amount,
      balanceAfter: row.balance_after,
      type: row.type,
      description: row.description,
      taskId: row.task_id,
      createdAt: row.created_at,
    };
  }
}
