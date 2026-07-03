import { v4 as uuid } from 'uuid';
import { createLogger } from '../../services/logger.js';
const log = createLogger('CreditsRepository');
export class CreditsRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    deduct(userId, amount, type, description, taskId) {
        const id = uuid();
        const now = new Date().toISOString();
        // Atomic deduct: UPDATE with balance check in WHERE clause. Both the
        // UPDATE and the audit INSERT run inside a transaction so a crash between
        // them cannot leave a decremented balance without an audit row.
        const tx = this.db.transaction(() => {
            const result = this.db.prepare('UPDATE users SET credits = credits - ?, updated_at = ? WHERE id = ? AND credits >= ?').run(amount, now, userId, amount);
            if (result.changes === 0) {
                throw new Error('Insufficient credits');
            }
            const newBalance = this.getBalance(userId);
            this.db.prepare('INSERT INTO credit_transactions (id, user_id, amount, balance_after, type, description, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, userId, -amount, newBalance, type, description ?? null, taskId ?? null, now);
            return newBalance;
        });
        const newBalance = tx();
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
    add(userId, amount, type, description) {
        const id = uuid();
        const now = new Date().toISOString();
        // Atomic add: increment via `credits = credits + ?` (no read-modify-write)
        // and capture the resulting balance in the same transaction for the audit
        // row. Two concurrent adds cannot lose credits.
        const tx = this.db.transaction(() => {
            const result = this.db.prepare('UPDATE users SET credits = credits + ?, updated_at = ? WHERE id = ?').run(amount, now, userId);
            if (result.changes === 0) {
                throw new Error('User not found');
            }
            const newBalance = this.getBalance(userId);
            this.db.prepare('INSERT INTO credit_transactions (id, user_id, amount, balance_after, type, description, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, userId, amount, newBalance, type, description ?? null, null, now);
            return newBalance;
        });
        const newBalance = tx();
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
    getBalance(userId) {
        const row = this.db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
        return row ? row.credits : 0;
    }
    getHistory(userId, limit = 50, offset = 0) {
        const rows = this.db.prepare('SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(userId, limit, offset);
        return rows.map(r => this.mapRow(r));
    }
    mapRow(row) {
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
//# sourceMappingURL=credits.js.map