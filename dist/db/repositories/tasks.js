import { v4 as uuid } from 'uuid';
export class TasksRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    create(sessionId, description, model, maxSteps = 100) {
        const id = uuid();
        const now = new Date().toISOString();
        this.db.prepare('INSERT INTO tasks (id, session_id, description, status, model, max_steps, current_step, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, sessionId, description, 'pending', model, maxSteps, 0, now, now);
        return {
            id, sessionId, description, status: 'pending', model, maxSteps, currentStep: 0, result: null, error: null, createdAt: now, updatedAt: now,
        };
    }
    findById(id) {
        const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
        if (!row)
            return undefined;
        return this.mapRow(row);
    }
    findBySession(sessionId) {
        const rows = this.db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC').all(sessionId);
        return rows.map(this.mapRow);
    }
    list() {
        const rows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
        return rows.map(this.mapRow);
    }
    updateStatus(id, status, result = null, error = null) {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE tasks SET status = ?, result = COALESCE(?, result), error = COALESCE(?, error), updated_at = ? WHERE id = ?').run(status, result, error, now, id);
    }
    incrementStep(id) {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE tasks SET current_step = current_step + 1, updated_at = ? WHERE id = ?').run(now, id);
    }
    mapRow(row) {
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
            userId: row.user_id ?? undefined,
            workspaceDir: row.workspace_dir ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
//# sourceMappingURL=tasks.js.map