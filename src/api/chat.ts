import { Router } from 'express';
import type Database from 'better-sqlite3';
import type { TaskManager, StreamEvent } from '../services/task-manager.js';
import type { CreditManager } from '../services/credit-manager.js';
import type { CompactionService } from '../services/compaction-service.js';
import { MessagesRepository } from '../db/repositories/messages.js';
import { ConfigRepository } from '../db/repositories/config.js';
import { SessionsRepository } from '../db/repositories/sessions.js';
import { UsersRepository } from '../db/repositories/users.js';
import { ProjectsRepository } from '../db/repositories/projects.js';
import { resolveModels } from '../services/model-resolver.js';
import { config } from '../config.js';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createLogger } from '../services/logger.js';

const log = createLogger('ChatAPI');

export function createChatRouter(db: Database.Database, taskManager: TaskManager, creditManager: CreditManager, compactionService: CompactionService) {
  const router = Router();
  const messagesRepo = new MessagesRepository(db);
  const configRepo = new ConfigRepository(db);
  const sessionsRepo = new SessionsRepository(db);
  const usersRepo = new UsersRepository(db);
  const projectsRepo = new ProjectsRepository(db);

  // POST /compact — Compress conversation context for a session
  router.post('/compact', async (req, res) => {
    const { sessionId } = req.body;
    const userId = req.user?.userId;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    // Verify ownership
    const session = sessionsRepo.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin && session.userId && session.userId !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    try {
      const summary = await compactionService.compactSession(sessionId);
      res.json({ success: true, summary });
    } catch (err: any) {
      log.error('Compaction failed', { sessionId, error: err.message });
      res.status(500).json({ error: `Compaction failed: ${err.message}` });
    }
  });

  router.post('/', async (req, res) => {
    const { sessionId, model, messages, maxSteps } = req.body;
    const userId = req.user?.userId;
    const user = userId ? usersRepo.findById(userId) : undefined;
    const username = user?.username ?? 'default';

    let workspaceDir = resolve(config.workspaceBaseDir, username);

    if (userId && !creditManager.hasCredits(userId)) {
      res.status(402).json({ error: 'Insufficient credits. Please contact admin to add more credits.' });
      return;
    }

    let effectiveSessionId = sessionId;
    if (!effectiveSessionId) {
      let sessions = sessionsRepo.list();
      if (userId) {
        sessions = sessions.filter(s => s.userId === userId);
      }
      if (sessions.length === 0) {
        const session = sessionsRepo.create('Default Session', config.defaultModel);
        effectiveSessionId = session.id;
        if (userId) {
          try {
            db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run(userId, session.id);
          } catch (err: any) {
            log.error('Failed to assign session owner', { sessionId: session.id, userId, error: err.message });
          }
        }
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
        if (userId) {
          try {
            db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run(userId, session.id);
          } catch (err: any) {
            log.error('Failed to assign session owner', { sessionId: session.id, userId, error: err.message });
          }
        }
      } else {
        // Ownership check: a non-admin may only chat in their own session.
        // Sessions with user_id NULL (legacy) are treated as admin-only / orphan
        // and cannot be addressed by another user even if they know the id.
        const isAdmin = req.user?.role === 'admin';
        if (!isAdmin && existing.userId && existing.userId !== userId) {
          log.warn('Chat denied — session owned by another user', { sessionId: effectiveSessionId, userId, ownerId: existing.userId });
          res.status(403).json({ error: 'Access denied' });
          return;
        }
      }
    }

    log.info('Chat request received', { sessionId, model, messageCount: messages?.length, maxSteps, userId, workspaceDir });

    if (!messages?.length) {
      log.warn('Chat request rejected: no messages');
      res.status(400).json({ error: 'messages are required' });
      return;
    }

    let projectInfo: { uuid: string; name: string; type: 'static' | 'php' | 'node'; publicUrl: string } | undefined;

    if (effectiveSessionId) {
      try {
        const projectRow = db.prepare('SELECT * FROM projects WHERE session_id = ?').get(effectiveSessionId) as any;
        if (projectRow && projectRow.folder_path) {
          const projectDir = resolve(config.workspaceBaseDir, username, projectRow.folder_path);
          mkdirSync(projectDir, { recursive: true });
          workspaceDir = projectDir;
          log.info('Using project workspace directory', { sessionId: effectiveSessionId, workspaceDir });

          const publicBaseUrl = config.publicBaseUrl;
          if (publicBaseUrl && projectRow.uuid) {
            const base = publicBaseUrl.replace(/\/+$/, '');
            projectInfo = {
              uuid: projectRow.uuid,
              name: projectRow.name,
              type: projectRow.type,
              publicUrl: `${base}/${projectRow.uuid}`,
            };
          }
        }
      } catch (err: any) {
        log.warn('Failed to resolve project workspace', { error: err.message });
      }
    }

    // Persist incoming messages to the database. Only user/assistant/tool roles
    // are accepted from the client; `system` messages are reserved for internal
    // summary injection and must never come from a request body.
    const allowedRoles = new Set(['user', 'assistant', 'tool']);
    for (const msg of messages) {
      if (!allowedRoles.has(msg.role)) {
        log.warn('Chat rejected — invalid message role', { role: msg.role });
        res.status(400).json({ error: `Invalid message role: ${msg.role}` });
        return;
      }
      messagesRepo.create(effectiveSessionId, msg.role, msg.content);
    }

    // Auto-compact if the conversation is getting too long
    const selectedModel = model ?? configRepo.getAll().defaultModel;
    try {
      const didCompact = await compactionService.autoCompactIfNeeded(effectiveSessionId, selectedModel);
      if (didCompact) {
        log.info('Auto-compacted session before sending to agent', { sessionId: effectiveSessionId });
      }
    } catch (err: any) {
      log.warn('Auto-compaction check failed, continuing anyway', { error: err.message });
    }

    // Build the full conversation context (including any previous summary)
    const conversationContext = compactionService.getConversationContext(effectiveSessionId);

    const appConfig = configRepo.getAll();

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

    const description = messages[messages.length - 1].content;
    log.info('Creating task for chat', { selectedModel, descriptionLength: description.length, contextLength: conversationContext.length });

    const task = taskManager.createTask(effectiveSessionId, description, selectedModel, maxSteps, userId, workspaceDir, projectInfo, conversationContext);

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
