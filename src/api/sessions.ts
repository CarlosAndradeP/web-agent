import { Router } from 'express';
import type Database from 'better-sqlite3';
import { SessionsRepository } from '../db/repositories/sessions.js';
import { MessagesRepository } from '../db/repositories/messages.js';

export function createSessionsRouter(db: Database.Database) {
  const router = Router();
  const sessionsRepo = new SessionsRepository(db);
  const messagesRepo = new MessagesRepository(db);

  router.get('/', (_req, res) => {
    res.json({ sessions: sessionsRepo.list() });
  });

  router.post('/', (req, res) => {
    const { name, model } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const session = sessionsRepo.create(name, model ?? 'z-ai/glm-5.1');
    res.status(201).json({ session });
  });

  router.get('/:id/messages', (req, res) => {
    const messages = messagesRepo.findBySession(req.params.id);
    res.json({ messages });
  });

  router.delete('/:id', (req, res) => {
    sessionsRepo.delete(req.params.id);
    res.json({ success: true });
  });

  return router;
}
