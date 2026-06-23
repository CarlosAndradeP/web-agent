import { createLogger } from '../services/logger.js';
const log = createLogger('Migration');
export function migrate(db) {
    const alterStatements = [
        { table: 'sessions', column: 'user_id', type: 'TEXT' },
        { table: 'messages', column: 'user_id', type: 'TEXT' },
        { table: 'tasks', column: 'user_id', type: 'TEXT' },
        { table: 'tasks', column: 'workspace_dir', type: 'TEXT' },
        { table: 'sessions', column: 'project_id', type: 'TEXT' },
        { table: 'projects', column: 'session_id', type: 'TEXT' },
    ];
    for (const stmt of alterStatements) {
        try {
            db.exec(`ALTER TABLE ${stmt.table} ADD COLUMN ${stmt.column} ${stmt.type}`);
            log.info('Column added', { table: stmt.table, column: stmt.column });
        }
        catch (err) {
            if (err.message?.includes('duplicate column name') || err.message?.includes('already exists')) {
                log.debug('Column already exists, skipping', { table: stmt.table, column: stmt.column });
            }
            else {
                log.warn('ALTER TABLE failed', { table: stmt.table, column: stmt.column, error: err.message });
            }
        }
    }
    try {
        const row = db.prepare("SELECT COUNT(*) as count FROM users WHERE username = 'admin'").get();
        if (row.count === 0) {
            const existingSessions = db.prepare("SELECT id FROM sessions WHERE user_id IS NULL LIMIT 1").get();
            if (existingSessions) {
                db.prepare("UPDATE sessions SET user_id = '__migration__' WHERE user_id IS NULL").run();
                db.prepare("UPDATE messages SET user_id = '__migration__' WHERE user_id IS NULL").run();
                db.prepare("UPDATE tasks SET user_id = '__migration__' WHERE user_id IS NULL").run();
                log.info('Migrated existing records to placeholder user_id');
            }
        }
    }
    catch (err) {
        log.warn('Data migration skipped', { error: err.message });
    }
    try {
        db.prepare("UPDATE config SET value = 'none' WHERE key = 'approval_mode' AND value = 'custom'").run();
        log.info('Migrated approval_mode from custom to none (default changed)');
    }
    catch (err) {
        log.warn('approval_mode migration skipped', { error: err.message });
    }
    log.info('Migration complete');
}
//# sourceMappingURL=migrate.js.map