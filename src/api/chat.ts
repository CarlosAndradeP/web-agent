import { Router } from 'express';
import type Database from 'better-sqlite3';
import type { TaskManager } from '../services/task-manager.js';
import { MessagesRepository } from '../db/repositories/messages.js';
import { ConfigRepository } from '../db/repositories/config.js';

export function createChatRouter(db: Database.Database, taskManager: TaskManager) {
  const router = Router();
  const messagesRepo = new MessagesRepository(db);
  const configRepo = new ConfigRepository(db);

  router.post('/', async (req, res) => {
    const { sessionId, model, messages, maxSteps } = req.body;

    if (!messages?.length) {
      res.status(400).json({ error: 'messages are required' });
      return;
    }

    const effectiveSessionId = sessionId ?? (db.prepare('SELECT id FROM sessions LIMIT 1').get() as any)?.id ?? 'default';

    for (const msg of messages) {
      messagesRepo.create(effectiveSessionId, msg.role, msg.content);
    }

    const appConfig = configRepo.getAll();
    const selectedModel = model ?? appConfig.defaultModel;
    const description = messages[messages.length - 1].content;

    const task = taskManager.createTask(effectiveSessionId, description, selectedModel, maxSteps);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      const textStream = await taskManager.streamTask(task.id);

      res.write(`data: ${JSON.stringify({ type: 'task-start', taskId: task.id })}\n\n`);

      for await (const chunk of textStream) {
        res.write(`data: ${JSON.stringify({ type: 'text-delta', content: chunk })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ type: 'finish', taskId: task.id })}\n\n`);
      res.end();
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    }
  });

  return router;
}
