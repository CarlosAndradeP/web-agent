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
        { table: 'messages', column: 'is_compacted', type: 'INTEGER DEFAULT 0' },
        { table: 'messages', column: 'model_context', type: 'TEXT DEFAULT NULL' },
        { table: 'sessions', column: 'summary_text', type: 'TEXT DEFAULT NULL' },
        { table: 'orchestrator_sessions', column: 'total_steps_used', type: 'INTEGER DEFAULT 0' },
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
    try {
        const hasOldTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='orchestrator_sessions'").get();
        const columns = hasOldTable ? db.pragma('table_info(orchestrator_sessions)') : [];
        const sessionIdColumn = columns.find(column => column.name === 'session_id');
        const needsNullableSessionMigration = Boolean(sessionIdColumn?.notnull);
        if (hasOldTable && needsNullableSessionMigration) {
            db.pragma('foreign_keys = OFF');
            try {
                db.exec('DROP TABLE IF EXISTS orchestrator_sessions_new');
                db.exec(`
          CREATE TABLE orchestrator_sessions_new (
            id TEXT PRIMARY KEY,
            session_id TEXT DEFAULT NULL REFERENCES sessions(id) ON DELETE SET NULL,
            user_id TEXT,
            status TEXT NOT NULL DEFAULT 'idle',
            objective TEXT NOT NULL,
            current_step TEXT DEFAULT NULL,
            progress_percent INTEGER DEFAULT 0,
            error_count INTEGER DEFAULT 0,
            total_steps_used INTEGER DEFAULT 0,
            auto_recover INTEGER DEFAULT 1,
            workspace_dir TEXT DEFAULT NULL,
            md_files TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          INSERT OR IGNORE INTO orchestrator_sessions_new (id, session_id, user_id, status, objective, current_step, progress_percent, error_count, total_steps_used, auto_recover, workspace_dir, md_files, created_at, updated_at)
          SELECT id, NULLIF(session_id, ''), user_id, status, objective, current_step, progress_percent, error_count, total_steps_used, auto_recover, workspace_dir, md_files, created_at, updated_at
          FROM orchestrator_sessions;
          DROP TABLE orchestrator_sessions;
          ALTER TABLE orchestrator_sessions_new RENAME TO orchestrator_sessions;
        `);
                log.info('Migrated orchestrator_sessions: session_id now nullable');
            }
            finally {
                db.pragma('foreign_keys = ON');
            }
        }
    }
    catch (err) {
        log.warn('orchestrator_sessions migration failed', { error: err.message });
        try {
            db.pragma('foreign_keys = ON');
        }
        catch { }
        try {
            db.exec('DROP TABLE IF EXISTS orchestrator_sessions_new');
        }
        catch { }
    }
    const orchestratorTables = [
        `CREATE TABLE IF NOT EXISTS orchestrator_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT DEFAULT NULL REFERENCES sessions(id) ON DELETE SET NULL,
      user_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      objective TEXT NOT NULL,
      current_step TEXT DEFAULT NULL,
      progress_percent INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      total_steps_used INTEGER DEFAULT 0,
      auto_recover INTEGER DEFAULT 1,
      workspace_dir TEXT DEFAULT NULL,
      md_files TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
        `CREATE TABLE IF NOT EXISTS orchestrator_steps (
      id TEXT PRIMARY KEY,
      orchestrator_session_id TEXT NOT NULL REFERENCES orchestrator_sessions(id) ON DELETE CASCADE,
      step_number INTEGER NOT NULL,
      role TEXT NOT NULL,
      model TEXT NOT NULL,
      action TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT DEFAULT NULL,
      duration_ms INTEGER DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME DEFAULT NULL
    )`,
        `CREATE TABLE IF NOT EXISTS orchestrator_state (
      id TEXT PRIMARY KEY DEFAULT 'singleton',
      is_running INTEGER DEFAULT 0,
      last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
      current_session_id TEXT DEFAULT NULL REFERENCES orchestrator_sessions(id),
      total_steps_completed INTEGER DEFAULT 0
    )`,
    ];
    for (const stmt of orchestratorTables) {
        try {
            db.exec(stmt);
            log.info('Orchestrator table ensured');
        }
        catch (err) {
            log.warn('Orchestrator table creation failed', { error: err.message });
        }
    }
    const orchestratorIndexes = [
        'CREATE INDEX IF NOT EXISTS idx_orchestrator_sessions_user_id ON orchestrator_sessions(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_orchestrator_sessions_session_id ON orchestrator_sessions(session_id)',
        'CREATE INDEX IF NOT EXISTS idx_orchestrator_sessions_status ON orchestrator_sessions(status)',
        'CREATE INDEX IF NOT EXISTS idx_orchestrator_steps_session_id ON orchestrator_steps(orchestrator_session_id)',
    ];
    for (const stmt of orchestratorIndexes) {
        try {
            db.exec(stmt);
        }
        catch (err) {
            log.warn('Orchestrator index creation skipped', { statement: stmt, error: err.message });
        }
    }
    try {
        db.prepare("INSERT OR IGNORE INTO orchestrator_state (id, is_running, last_heartbeat, current_session_id, total_steps_completed) VALUES ('singleton', 0, datetime('now'), NULL, 0)").run();
        log.info('Orchestrator state singleton ensured');
    }
    catch (err) {
        log.warn('Orchestrator state init skipped', { error: err.message });
    }
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS pix_payments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider_payment_id TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        credits INTEGER NOT NULL,
        amount_brl REAL NOT NULL,
        qr_code TEXT,
        qr_code_base64 TEXT,
        ticket_url TEXT,
        credited_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
        db.exec('CREATE INDEX IF NOT EXISTS idx_pix_payments_user_id ON pix_payments(user_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_pix_payments_provider_payment_id ON pix_payments(provider_payment_id)');
        log.info('pix_payments table and indexes ensured');
    }
    catch (err) {
        log.warn('pix_payments migration failed', { error: err.message });
    }
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS model_benchmark_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        categories TEXT NOT NULL,
        model_count INTEGER NOT NULL,
        completed_models INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME DEFAULT NULL
      );
      CREATE TABLE IF NOT EXISTS model_benchmark_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES model_benchmark_runs(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        category TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        success INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER,
        quality_score INTEGER NOT NULL DEFAULT 0,
        output_preview TEXT,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_model_benchmark_results_run_id ON model_benchmark_results(run_id);
      CREATE INDEX IF NOT EXISTS idx_model_benchmark_results_model_id ON model_benchmark_results(model_id);
    `);
        db.prepare("UPDATE model_benchmark_runs SET status = 'failed', completed_at = datetime('now') WHERE status IN ('pending', 'running')").run();
        log.info('Model benchmark tables ensured');
    }
    catch (err) {
        log.warn('Model benchmark migration failed', { error: err.message });
    }
    // Add orchestrator_tasks table (new in multi-agent orchestrator refactor)
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS orchestrator_tasks (
        id TEXT PRIMARY KEY,
        orchestrator_session_id TEXT NOT NULL REFERENCES orchestrator_sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        role TEXT NOT NULL DEFAULT 'programador',
        depends_on TEXT,
        result_json TEXT,
        output TEXT,
        error_message TEXT,
        step_number INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
        db.exec("CREATE INDEX IF NOT EXISTS idx_orchestrator_tasks_session ON orchestrator_tasks(orchestrator_session_id)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_orchestrator_tasks_status ON orchestrator_tasks(status)");
        log.info('orchestrator_tasks table and indexes ensured');
    }
    catch (err) {
        log.warn('orchestrator_tasks migration failed', { error: err.message });
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
        }
        catch (err) {
            log.warn('Index creation skipped', { statement: stmt, error: err.message });
        }
    }
    log.info('Performance indexes ensured');
    log.info('Migration complete');
}
//# sourceMappingURL=migrate.js.map