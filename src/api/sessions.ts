import { Router } from 'express';
import type Database from 'better-sqlite3';
import { SessionsRepository } from '../db/repositories/sessions.js';
import { MessagesRepository } from '../db/repositories/messages.js';
import { config } from '../config.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('SessionsAPI');

export function createSessionsRouter(db: Database.Database) {
  const router = Router();
  const sessionsRepo = new SessionsRepository(db);
  const messagesRepo = new MessagesRepository(db);

  const isAdmin = (req: any) => req.user?.role === 'admin';

  // GET / — List sessions. Non-admins see only their own
  router.get('/', (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const userId = req.user?.userId as string;

    if (isAdmin(req)) {
      const sessions = sessionsRepo.listPaginated(limit, offset);
      const total = sessionsRepo.count();
      res.json({ sessions, total, limit, offset });
    } else {
      const sessions = sessionsRepo.findByUserId(userId, limit, offset);
      const total = sessionsRepo.countByUserId(userId);
      res.json({ sessions, total, limit, offset });
    }
  });

  router.post('/', (req, res) => {
    const { name, model } = req.body;
    const userId = req.user?.userId;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const session = sessionsRepo.create(name, model ?? config.defaultModel);
    if (userId) {
      // Wrap in a transaction so a failure leaves both the INSERT and the
      // ownership UPDATE either fully applied or rolled back, instead of an
      // unowned row that any non-admin could later read/delete.
      const tx = db.transaction(() => {
        db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run(userId, session.id);
      });
      try {
        tx();
      } catch (err: any) {
        log.error('Failed to assign session owner — leaving session deleted', { sessionId: session.id, userId, error: err.message });
        sessionsRepo.delete(session.id);
        res.status(500).json({ error: 'Failed to create session' });
        return;
      }
    }
    res.status(201).json({ session });
  });

  // GET /:id/messages — Verify ownership for non-admins
  router.get('/:id/messages', (req, res) => {
    const session = sessionsRepo.findById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!isAdmin(req) && session.userId !== req.user?.userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const messages = messagesRepo.findBySession(req.params.id);
    res.json({ messages });
  });

  // DELETE /:id/messages — Clear all messages in a session
  router.delete('/:id/messages', (req, res) => {
    const session = sessionsRepo.findById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!isAdmin(req) && session.userId !== req.user?.userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const deleted = db.transaction(() => {
      const active = db.prepare("SELECT 1 FROM tasks WHERE session_id = ? AND status IN ('pending', 'running') LIMIT 1").get(req.params.id);
      if (active) return null;
      const count = messagesRepo.deleteBySession(req.params.id);
      sessionsRepo.updateSummary(req.params.id, '');
      return count;
    })();
    if (deleted === null) {
      res.status(409).json({ error: 'Stop the active task before clearing its history' });
      return;
    }
    res.json({ success: true, deleted });
  });

  // DELETE /:id — Verify ownership for non-admins
  router.delete('/:id', (req, res) => {
    const session = sessionsRepo.findById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!isAdmin(req) && session.userId !== req.user?.userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (db.prepare("SELECT 1 FROM tasks WHERE session_id = ? AND status IN ('pending', 'running') LIMIT 1").get(req.params.id)) {
      res.status(409).json({ error: 'Stop the active task before deleting its session' });
      return;
    }
    sessionsRepo.delete(req.params.id);
    res.json({ success: true });
  });

  return router;
}
