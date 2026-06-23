import { v4 as uuid } from 'uuid';
export class SessionsRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    create(name, model) {
        const id = uuid();
        const now = new Date().toISOString();
        this.db.prepare('INSERT INTO sessions (id, name, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, name, model, now, now);
        return { id, name, model, createdAt: now, updatedAt: now };
    }
    findById(id) {
        const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
        if (!row)
            return undefined;
        return {
            id: row.id,
            name: row.name,
            model: row.model,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    list() {
        const rows = this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
        return rows.map(row => ({
            id: row.id,
            name: row.name,
            model: row.model,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));
    }
    delete(id) {
        this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    }
}
//# sourceMappingURL=sessions.js.map