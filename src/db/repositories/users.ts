import type Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { createLogger } from '../../services/logger.js';

const log = createLogger('UsersRepository');

export interface User {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  role: 'admin' | 'user';
  credits: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserPublic {
  id: string;
  username: string;
  email: string | null;
  role: 'admin' | 'user';
  credits: number;
  createdAt: string;
  updatedAt: string;
}

export function toPublic(user: User): UserPublic {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    credits: user.credits,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class UsersRepository {
  constructor(private db: Database.Database) {}

  create(username: string, password: string, role: 'admin' | 'user' = 'user', credits = 100, email?: string): User {
    const id = uuid();
    const now = new Date().toISOString();
    const passwordHash = bcrypt.hashSync(password, 10);
    this.db.prepare(
      'INSERT INTO users (id, username, email, password_hash, role, credits, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, username, email ?? null, passwordHash, role, credits, now, now);
    log.info('User created', { id, username, role });
    return this.findById(id)!;
  }

  findById(id: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : undefined;
  }

  findByUsername(username: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    return row ? this.mapRow(row) : undefined;
  }

  list(): User[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as any[];
    return rows.map(r => this.mapRow(r));
  }

  updateCredits(id: string, credits: number): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE users SET credits = ?, updated_at = ? WHERE id = ?').run(credits, now, id);
  }

  addCredits(id: string, amount: number): number {
    const user = this.findById(id);
    if (!user) throw new Error('User not found');
    const newBalance = user.credits + amount;
    this.updateCredits(id, newBalance);
    return newBalance;
  }

  updateRole(id: string, role: 'admin' | 'user'): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, now, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  verifyPassword(user: User, password: string): boolean {
    return bcrypt.compareSync(password, user.password_hash);
  }

  updatePassword(id: string, newPassword: string): void {
    const now = new Date().toISOString();
    const passwordHash = bcrypt.hashSync(newPassword, 10);
    this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, id);
    log.info('Password updated', { id });
  }

  updateEmail(id: string, email: string | null): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?').run(email, now, id);
  }

  private mapRow(row: any): User {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      password_hash: row.password_hash,
      role: row.role,
      credits: row.credits,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
