import { v4 as uuid } from 'uuid';
import { createLogger } from '../../services/logger.js';
const log = createLogger('ProjectsRepository');
export class ProjectsRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    create(userId, name, folderPath, type, sessionId, status = 'active') {
        const id = uuid();
        const projectUuid = uuid();
        const now = new Date().toISOString();
        this.db.prepare('INSERT INTO projects (id, uuid, user_id, name, folder_path, type, status, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, projectUuid, userId, name, folderPath, type, status, sessionId ?? null, now, now);
        log.info('Project created', { id, uuid: projectUuid, userId, name, type, status, sessionId });
        return this.findById(id);
    }
    findById(id) {
        const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
        return row ? this.mapRow(row) : undefined;
    }
    findByUuid(uuid) {
        const row = this.db.prepare('SELECT * FROM projects WHERE uuid = ?').get(uuid);
        return row ? this.mapRow(row) : undefined;
    }
    findByUserId(userId) {
        const rows = this.db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC').all(userId);
        return rows.map(r => this.mapRow(r));
    }
    listAll() {
        const rows = this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
        return rows.map(r => this.mapRow(r));
    }
    updateStatus(id, status) {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    }
    updateType(id, type) {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE projects SET type = ?, updated_at = ? WHERE id = ?').run(type, now, id);
    }
    updatePort(id, port) {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE projects SET port = ?, updated_at = ? WHERE id = ?').run(port, now, id);
    }
    updatePid(id, pid) {
        this.db.prepare('UPDATE projects SET pid = ? WHERE id = ?').run(pid, id);
    }
    delete(id) {
        this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    }
    countByUserId(userId) {
        const row = this.db.prepare('SELECT COUNT(*) as count FROM projects WHERE user_id = ?').get(userId);
        return row.count;
    }
    mapRow(row) {
        return {
            id: row.id,
            uuid: row.uuid,
            userId: row.user_id,
            name: row.name,
            folderPath: row.folder_path,
            type: row.type,
            port: row.port,
            pid: row.pid,
            status: row.status,
            sessionId: row.session_id ?? null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
//# sourceMappingURL=projects.js.map