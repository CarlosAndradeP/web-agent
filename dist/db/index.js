import Database from 'better-sqlite3';
import { mkdirSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { schema } from './schema.js';
import { migrate } from './migrate.js';
import { createLogger } from '../services/logger.js';
const log = createLogger('Database');
export function initDatabase(dbPath) {
    log.info('Initializing database', { dbPath });
    mkdirSync(dirname(dbPath), { recursive: true });
    if (existsSync(dbPath)) {
        try {
            const tempDb = new Database(dbPath, { readonly: true });
            const integrityResult = tempDb.pragma('integrity_check');
            tempDb.close();
            const firstResult = integrityResult[0]?.integrity_check;
            if (firstResult && firstResult !== 'ok') {
                log.warn('SQLite integrity check failed, creating backup and reinitializing', { result: firstResult });
                const backupPath = dbPath + '.corrupt.' + Date.now();
                copyFileSync(dbPath, backupPath);
                log.info('Corrupt DB backed up', { backupPath });
                try {
                    unlinkSync(dbPath);
                }
                catch { }
                const walPath = dbPath + '-wal';
                const shmPath = dbPath + '-shm';
                try {
                    unlinkSync(walPath);
                }
                catch { }
                try {
                    unlinkSync(shmPath);
                }
                catch { }
            }
            else {
                log.info('SQLite integrity check passed');
            }
        }
        catch (err) {
            log.warn('SQLite integrity check error, will attempt to open anyway', { error: err.message });
        }
    }
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // Give waiting writers a chance to acquire locks instead of failing fast with
    // SQLITE_BUSY when a concurrent writer holds the lock. 5s is plenty for the
    // short write transactions in this project (credit deducts, compaction, etc.).
    db.pragma('busy_timeout = 5000');
    db.exec(schema);
    migrate(db);
    log.info('Database initialized, schema applied, migrations ran');
    return db;
}
//# sourceMappingURL=index.js.map