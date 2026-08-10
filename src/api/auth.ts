import { Router } from 'express';
import type Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { UsersRepository, toPublic } from '../db/repositories/users.js';
import { CreditsRepository } from '../db/repositories/credits.js';
import { ConfigRepository } from '../db/repositories/config.js';
import { signAccessToken, signRefreshToken, verifyToken, verifyRefreshToken } from '../lib/jwt.js';
import { createLogger } from '../services/logger.js';
import { v4 as uuid } from 'uuid';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { config } from '../config.js';

const log = createLogger('AuthAPI');

export function createAuthRouter(db: Database.Database, authLimiter?: any, refreshLimiter?: any) {
  const router = Router();
  const usersRepo = new UsersRepository(db);
  const creditsRepo = new CreditsRepository(db);
  const configRepo = new ConfigRepository(db);

  if (authLimiter) router.use('/login', authLimiter);
  if (authLimiter) router.use('/register', authLimiter);
  if (refreshLimiter) router.use('/refresh', refreshLimiter);

  router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }

    const user = usersRepo.findByUsername(username);
    if (!user || !usersRepo.verifyPassword(user, password)) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const accessToken = signAccessToken({ userId: user.id, role: user.role });
    const refreshToken = signRefreshToken({ userId: user.id });
    const refreshTokenHash = bcrypt.hashSync(refreshToken, 10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(
      'INSERT INTO auth_sessions (id, user_id, refresh_token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(uuid(), user.id, refreshTokenHash, expiresAt, new Date().toISOString());

    log.info('User logged in', { userId: user.id, username: user.username });
    res.json({ accessToken, refreshToken, user: toPublic(user) });
  });

  router.get('/registration-status', (_req, res) => {
    const enabled = configRepo.get('registration_enabled') !== 'false';
    res.json({ registrationEnabled: enabled });
  });

  router.post('/register', async (req, res) => {
    const registrationEnabled = configRepo.get('registration_enabled');
    if (registrationEnabled === 'false') {
      res.status(403).json({ error: 'Registration is currently disabled' });
      return;
    }

    const { username, password, email } = req.body;
    if (!username || !password || !email) {
      res.status(400).json({ error: 'username, password and email are required' });
      return;
    }
    if (typeof username !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/.test(username) || password.length < 6) {
      res.status(400).json({ error: 'username must be 3-32 characters using only letters, numbers, _ or -; password must be 6+ characters' });
      return;
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'A valid email is required' });
      return;
    }

    const existing = usersRepo.findByUsername(username);
    if (existing) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }

    const initialCredits = config.initialCredits;
    const user = usersRepo.create(username, password, 'user', initialCredits, email.trim());
    creditsRepo.add(user.id, initialCredits, 'bonus', 'Initial credits');

    mkdirSync(resolve(config.workspaceBaseDir, username), { recursive: true });

    log.info('User registered', { userId: user.id, username: user.username });

    const accessToken = signAccessToken({ userId: user.id, role: user.role });
    const refreshToken = signRefreshToken({ userId: user.id });
    const refreshTokenHash = bcrypt.hashSync(refreshToken, 10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO auth_sessions (id, user_id, refresh_token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(uuid(), user.id, refreshTokenHash, expiresAt, new Date().toISOString());

    res.status(201).json({ accessToken, refreshToken, user: toPublic(user) });
  });

  router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ error: 'refreshToken is required' });
      return;
    }

    try {
      const payload = verifyRefreshToken(refreshToken);
      const user = usersRepo.findById(payload.userId);
      if (!user) {
        res.status(401).json({ error: 'User not found' });
        return;
      }

      // Load only the user's non-expired sessions. Cap the loop iteration count
      // to avoid pathological bcrypt-amplification DoS if a user accumulates
      // many refresh tokens.
      const sessions = db.prepare('SELECT * FROM auth_sessions WHERE user_id = ? AND expires_at > ?').all(user.id, new Date().toISOString()) as any[];
      let validSession: any = null;
      const compareLimit = Math.min(sessions.length, 20);
      for (let i = 0; i < compareLimit; i++) {
        if (bcrypt.compareSync(refreshToken, sessions[i].refresh_token_hash)) {
          validSession = sessions[i];
          break;
        }
      }
      if (!validSession) {
        // Prune all expired sessions opportunistically. Closes DB rows that no
        // longer correspond to a usable token and bounds future loop cost.
        try { db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND expires_at <= ?').run(user.id, new Date().toISOString()); } catch {}
        res.status(401).json({ error: 'Invalid refresh token' });
        return;
      }

      // Rotation: delete the consumed token
      db.prepare('DELETE FROM auth_sessions WHERE id = ?').run(validSession.id);

      const accessToken = signAccessToken({ userId: user.id, role: user.role });
      const newRefreshToken = signRefreshToken({ userId: user.id });
      const newRefreshTokenHash = bcrypt.hashSync(newRefreshToken, 10);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(
        'INSERT INTO auth_sessions (id, user_id, refresh_token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(uuid(), user.id, newRefreshTokenHash, expiresAt, new Date().toISOString());

      res.json({ accessToken, refreshToken: newRefreshToken, user: toPublic(user) });
    } catch {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
  });

  router.get('/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authorization required' });
      return;
    }

    try {
      const payload = verifyToken(authHeader.slice(7));
      const user = usersRepo.findById(payload.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json({ user: toPublic(user) });
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });

  router.post('/logout', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = verifyToken(authHeader.slice(7));
        db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(payload.userId);
      } catch {}
    }
    res.json({ success: true });
  });

  router.post('/change-password', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authorization required' });
      return;
    }
    try {
      const payload = verifyToken(authHeader.slice(7));
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: 'currentPassword and newPassword are required' });
        return;
      }
      if (newPassword.length < 6) {
        res.status(400).json({ error: 'New password must be at least 6 characters' });
        return;
      }
      const user = usersRepo.findById(payload.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      if (!usersRepo.verifyPassword(user, currentPassword)) {
        res.status(401).json({ error: 'Current password is incorrect' });
        return;
      }
      usersRepo.updatePassword(user.id, newPassword);
      log.info('Password changed', { userId: user.id });
      res.json({ success: true });
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });

  router.get('/credits/history', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authorization required' });
      return;
    }
    try {
      const payload = verifyToken(authHeader.slice(7));
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const history = creditsRepo.getHistory(payload.userId, limit, offset);
      const balance = creditsRepo.getBalance(payload.userId);
      res.json({ history, balance });
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });

  router.patch('/profile', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authorization required' });
      return;
    }
    try {
      const payload = verifyToken(authHeader.slice(7));
      const { email } = req.body;
      usersRepo.updateEmail(payload.userId, email ?? null);
      const user = usersRepo.findById(payload.userId);
      res.json({ user: user ? toPublic(user) : null });
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });

  return router;
}
