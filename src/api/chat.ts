import { Router } from 'express';
import type Database from 'better-sqlite3';
import type { TaskManager, StreamEvent } from '../services/task-manager.js';
import { MessagesRepository } from '../db/repositories/messages.js';
import { ConfigRepository } from '../db/repositories/config.js';
import { SessionsRepository } from '../db/repositories/sessions.js';
import { resolveModels } from '../services/model-resolver.js';
import { config } from '../config.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('ChatAPI');

export function createChatRouter(db: Database.Database, taskManager: TaskManager) {
  const router = Router();
  const messagesRepo = new MessagesRepository(db);
  const configRepo = new ConfigRepository(db);
  const sessionsRepo = new SessionsRepository(db);

  router.post('/', async (req, res) => {
    const { sessionId, model, messages, maxSteps } = req.body;

    log.info('Chat request received', { sessionId, model, messageCount: messages?.length, maxSteps });

    if (!messages?.length) {
      log.warn('Chat request rejected: no messages');
      res.status(400).json({ error: 'messages are required' });
      return;
    }

    let effectiveSessionId = sessionId;
    if (!effectiveSessionId) {
      const sessions = sessionsRepo.list();
      if (sessions.length === 0) {
        const session = sessionsRepo.create('Default Session', config.defaultModel);
        effectiveSessionId = session.id;
      } else {
        effectiveSessionId = sessions[0].id;
      }
      log.info('Session resolved', { effectiveSessionId });
    } else {
      const existing = sessionsRepo.findById(effectiveSessionId);
      if (!existing) {
        log.warn('Session not found, creating new', { sessionId: effectiveSessionId });
        const session = sessionsRepo.create('Default Session', config.defaultModel);
        effectiveSessionId = session.id;
      }
    }

    for (const msg of messages) {
      messagesRepo.create(effectiveSessionId, msg.role, msg.content);
    }

    const appConfig = configRepo.getAll();
    const selectedModel = model ?? appConfig.defaultModel;
    const description = messages[messages.length - 1].content;

    try {
      const availableModels = await resolveModels(appConfig.apiBaseUrl);
      if (!availableModels.find(m => m.id === selectedModel)) {
        log.warn('Requested model not available, using first available', { selectedModel, fallback: availableModels[0]?.id });
        if (availableModels.length > 0) {
          res.status(400).json({ error: `Model "${selectedModel}" is not available. Available models: ${availableModels.map(m => m.id).join(', ')}` });
          return;
        }
      }
    } catch (err: any) {
      log.warn('Could not validate model, proceeding anyway', { error: err.message });
    }

    log.info('Creating task for chat', { selectedModel, descriptionLength: description.length });

    const task = taskManager.createTask(effectiveSessionId, description, selectedModel, maxSteps);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      log.info('Client disconnected, canceling task', { taskId: task.id });
      clearInterval(keepAlive);
      taskManager.cancelTask(task.id);
    });

    try {
      log.info('Starting stream for task', { taskId: task.id });
      const eventStream = await taskManager.streamTask(task.id);

      res.write(`data: ${JSON.stringify({ type: 'task-start', taskId: task.id })}\n\n`);

      let totalEvents = 0;
      for await (const event of eventStream) {
        totalEvents++;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      log.info('Stream finished', { taskId: task.id, totalEvents });

      res.write(`data: ${JSON.stringify({ type: 'finish', taskId: task.id })}\n\n`);
      res.end();
    } catch (err: any) {
      log.error('Stream error in chat', { taskId: task.id, error: err.message, stack: err.stack });
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message, taskId: task.id })}\n\n`);
        res.end();
      } catch {
        log.error('Failed to write error to SSE response', { taskId: task.id });
        if (!res.headersSent) {
          res.status(500).json({ error: err.message });
        }
      }
    } finally {
      clearInterval(keepAlive);
    }
  });

  return router;
}
