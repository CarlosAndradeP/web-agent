import Database from 'better-sqlite3';
import { mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { schema } from './schema.js';
import { migrate } from './migrate.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Database');

export function initDatabase(dbPath: string): Database.Database {
  log.info('Initializing database', { dbPath });
  mkdirSync(dirname(dbPath), { recursive: true });

  if (existsSync(dbPath)) {
    try {
      const tempDb = new Database(dbPath, { readonly: true });
      const integrityResult = tempDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      tempDb.close();
      const firstResult = integrityResult[0]?.integrity_check;
      if (firstResult && firstResult !== 'ok') {
        log.warn('SQLite integrity check failed, creating backup and reinitializing', { result: firstResult });
        const backupPath = dbPath + '.corrupt.' + Date.now();
        copyFileSync(dbPath, backupPath);
        log.info('Corrupt DB backed up', { backupPath });
        const { unlinkSync } = require('node:fs');
        unlinkSync(dbPath);
        const walPath = dbPath + '-wal';
        const shmPath = dbPath + '-shm';
        try { unlinkSync(walPath); } catch {}
        try { unlinkSync(shmPath); } catch {}
      } else {
        log.info('SQLite integrity check passed');
      }
    } catch (err: any) {
      log.warn('SQLite integrity check error, will attempt to open anyway', { error: err.message });
    }
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  migrate(db);
  log.info('Database initialized, schema applied, migrations ran');
  return db;
}

export type DatabaseInstance = Database.Database;
