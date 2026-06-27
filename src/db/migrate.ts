import type Database from 'better-sqlite3';
import { createLogger } from '../services/logger.js';

const log = createLogger('Migration');

export function migrate(db: Database.Database): void {
  const alterStatements = [
    { table: 'sessions', column: 'user_id', type: 'TEXT' },
    { table: 'messages', column: 'user_id', type: 'TEXT' },
    { table: 'tasks', column: 'user_id', type: 'TEXT' },
    { table: 'tasks', column: 'workspace_dir', type: 'TEXT' },
    { table: 'sessions', column: 'project_id', type: 'TEXT' },
    { table: 'projects', column: 'session_id', type: 'TEXT' },
    { table: 'messages', column: 'is_compacted', type: 'INTEGER DEFAULT 0' },
    { table: 'sessions', column: 'summary_text', type: 'TEXT DEFAULT NULL' },
  ];

  for (const stmt of alterStatements) {
    try {
      db.exec(`ALTER TABLE ${stmt.table} ADD COLUMN ${stmt.column} ${stmt.type}`);
      log.info('Column added', { table: stmt.table, column: stmt.column });
    } catch (err: any) {
      if (err.message?.includes('duplicate column name') || err.message?.includes('already exists')) {
        log.debug('Column already exists, skipping', { table: stmt.table, column: stmt.column });
      } else {
        log.warn('ALTER TABLE failed', { table: stmt.table, column: stmt.column, error: err.message });
      }
    }
  }

  try {
    const row = db.prepare("SELECT COUNT(*) as count FROM users WHERE username = 'admin'").get() as any;
    if (row.count === 0) {
      const existingSessions = db.prepare("SELECT id FROM sessions WHERE user_id IS NULL LIMIT 1").get() as any;
      if (existingSessions) {
        db.prepare("UPDATE sessions SET user_id = '__migration__' WHERE user_id IS NULL").run();
        db.prepare("UPDATE messages SET user_id = '__migration__' WHERE user_id IS NULL").run();
        db.prepare("UPDATE tasks SET user_id = '__migration__' WHERE user_id IS NULL").run();
        log.info('Migrated existing records to placeholder user_id');
      }
    }
  } catch (err: any) {
    log.warn('Data migration skipped', { error: err.message });
  }

  try {
    db.prepare("UPDATE config SET value = 'none' WHERE key = 'approval_mode' AND value = 'custom'").run();
    log.info('Migrated approval_mode from custom to none (default changed)');
  } catch (err: any) {
    log.warn('approval_mode migration skipped', { error: err.message });
  }

  // Add performance indexes for existing databases
  const indexStatements = [
    'CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id)',
    'CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)',
    'CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)',
  ];

  for (const stmt of indexStatements) {
    try {
      db.exec(stmt);
    } catch (err: any) {
      log.warn('Index creation skipped', { statement: stmt, error: err.message });
    }
  }
  log.info('Performance indexes ensured');

  log.info('Migration complete');
}
