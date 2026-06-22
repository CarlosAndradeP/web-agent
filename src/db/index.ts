import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { schema } from './schema.js';
import { migrate } from './migrate.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Database');

export function initDatabase(dbPath: string): Database.Database {
  log.info('Initializing database', { dbPath });
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  migrate(db);
  log.info('Database initialized, schema applied, migrations ran');
  return db;
}

export type DatabaseInstance = Database.Database;
