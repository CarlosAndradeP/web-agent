import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { createLogger } from '../../services/logger.js';

const log = createLogger('ProjectsRepository');

export interface Project {
  id: string;
  uuid: string;
  userId: string;
  name: string;
  folderPath: string;
  type: 'static' | 'php' | 'node';
  port: number | null;
  pid: number | null;
  status: 'active' | 'stopped' | 'error';
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export class ProjectsRepository {
  constructor(private db: Database.Database) {}

  create(userId: string, name: string, folderPath: string, type: Project['type'], sessionId?: string, status: Project['status'] = 'active'): Project {
    const id = uuid();
    const projectUuid = uuid();
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO projects (id, uuid, user_id, name, folder_path, type, status, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, projectUuid, userId, name, folderPath, type, status, sessionId ?? null, now, now);
    log.info('Project created', { id, uuid: projectUuid, userId, name, type, status, sessionId });
    return this.findById(id)!;
  }

  findById(id: string): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : undefined;
  }

  findByUuid(uuid: string): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE uuid = ?').get(uuid) as any;
    return row ? this.mapRow(row) : undefined;
  }

  findByUserId(userId: string): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC').all(userId) as any[];
    return rows.map(r => this.mapRow(r));
  }

  listAll(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as any[];
    return rows.map(r => this.mapRow(r));
  }

  updateStatus(id: string, status: Project['status']): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }

  updateType(id: string, type: Project['type']): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE projects SET type = ?, updated_at = ? WHERE id = ?').run(type, now, id);
  }

  updatePort(id: string, port: number | null): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE projects SET port = ?, updated_at = ? WHERE id = ?').run(port, now, id);
  }

  updatePid(id: string, pid: number | null): void {
    this.db.prepare('UPDATE projects SET pid = ? WHERE id = ?').run(pid, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  countByUserId(userId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM projects WHERE user_id = ?').get(userId) as any;
    return row.count;
  }

  private mapRow(row: any): Project {
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
