import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { createLogger } from '../../services/logger.js';
const log = createLogger('UsersRepository');
export function toPublic(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        credits: user.credits,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };
}
export class UsersRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    create(username, password, role = 'user', credits = 100, email) {
        const id = uuid();
        const now = new Date().toISOString();
        const passwordHash = bcrypt.hashSync(password, 10);
        this.db.prepare('INSERT INTO users (id, username, email, password_hash, role, credits, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, username, email ?? null, passwordHash, role, credits, now, now);
        log.info('User created', { id, username, role });
        return this.findById(id);
    }
    findById(id) {
        const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        return row ? this.mapRow(row) : undefined;
    }
    findByUsername(username) {
        const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        return row ? this.mapRow(row) : undefined;
    }
    list() {
        const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
        return rows.map(r => this.mapRow(r));
    }
    updateCredits(id, credits) {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE users SET credits = ?, updated_at = ? WHERE id = ?').run(credits, now, id);
    }
    addCredits(id, amount) {
        const now = new Date().toISOString();
        const result = this.db.prepare('UPDATE users SET credits = credits + ?, updated_at = ? WHERE id = ?').run(amount, now, id);
        if (result.changes === 0)
            throw new Error('User not found');
        const user = this.findById(id);
        if (!user)
            throw new Error('User not found');
        return user.credits;
    }
    updateRole(id, role) {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, now, id);
    }
    delete(id) {
        this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    }
    verifyPassword(user, password) {
        return bcrypt.compareSync(password, user.password_hash);
    }
    updatePassword(id, newPassword) {
        const now = new Date().toISOString();
        const passwordHash = bcrypt.hashSync(newPassword, 10);
        this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, id);
        log.info('Password updated', { id });
    }
    updateEmail(id, email) {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?').run(email, now, id);
    }
    mapRow(row) {
        return {
            id: row.id,
            username: row.username,
            email: row.email,
            password_hash: row.password_hash,
            role: row.role,
            credits: row.credits,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
//# sourceMappingURL=users.js.map