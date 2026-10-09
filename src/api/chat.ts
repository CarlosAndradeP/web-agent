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
import { WordWorkspacesRepository } from '../db/repositories/word-workspaces.js';
import type { ModelMessage } from '@ai-sdk/provider-utils';
import { config } from '../config.js';
import { mkdirSync } from 'node:fs';
import { createLogger } from '../services/logger.js';
import { getUserWorkspaceDir, resolveUserWorkspacePath } from '../lib/workspace-paths.js';
import { writeSse } from '../lib/sse.js';

const log = createLogger('ChatAPI');

function compactToolValue(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized.length > 5000 ? `${serialized.slice(0, 5000)}...` : value;
  } catch {
    return String(value);
  }
}

export function createChatRouter(db: Database.Database, taskManager: TaskManager, creditManager: CreditManager, compactionService: CompactionService) {
  const router = Router();
  const messagesRepo = new MessagesRepository(db);
  const configRepo = new ConfigRepository(db);
  const sessionsRepo = new SessionsRepository(db);
  const usersRepo = new UsersRepository(db);
  const projectsRepo = new ProjectsRepository(db);
  const wordWorkspacesRepo = new WordWorkspacesRepository(db);
  const busySessions = new Set<string>();

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
    if (!isAdmin && session.userId !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    let compactLockAcquired = false;
    try {
      if (busySessions.has(sessionId) || taskManager.getTasksBySession(sessionId).some(task => task.status === 'running' || task.status === 'pending')) {
        res.status(409).json({ error: 'Stop the active task before compacting its history' });
        return;
      }
      busySessions.add(sessionId);
      compactLockAcquired = true;
      const summary = await compactionService.compactSession(sessionId);
      res.json({ success: true, summary });
    } catch (err: any) {
      log.error('Compaction failed', { sessionId, error: err.message });
      res.status(500).json({ error: `Compaction failed: ${err.message}` });
    } finally {
      if (compactLockAcquired) busySessions.delete(sessionId);
    }
  });

  router.post('/', async (req, res) => {
    const { sessionId, model, messages, maxSteps } = req.body;
    const userId = req.user?.userId;
    if (!Array.isArray(messages) || messages.length === 0 || messages.some(msg => !msg || typeof msg.content !== 'string' || typeof msg.role !== 'string') ||
        (sessionId != null && typeof sessionId !== 'string') ||
        (model !== undefined && (typeof model !== 'string' || !model.trim())) ||
        (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 500))) {
      res.status(400).json({ error: 'Valid messages, model and maxSteps (1-500) are required' });
      return;
    }
    const user = userId ? usersRepo.findById(userId) : undefined;
    const username = user?.username ?? 'default';

    let workspaceDir = getUserWorkspaceDir(username);

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
        res.status(404).json({ error: 'Session not found' });
        return;
      } else {
        // Ownership check: a non-admin may only chat in their own session.
        // Sessions with user_id NULL (legacy/orphan) are admin-only — a non-admin
        // cannot address them even if they know the id, since we cannot verify
        // ownership.
        const isAdmin = req.user?.role === 'admin';
        if (!isAdmin && existing.userId !== userId) {
          log.warn('Chat denied — session not owned by user', { sessionId: effectiveSessionId, userId, ownerId: existing.userId });
          res.status(403).json({ error: 'Access denied' });
          return;
        }
      }
    }

    log.info('Chat request received', { sessionId, model, messageCount: messages?.length, maxSteps, userId, workspaceDir });
    if (busySessions.has(effectiveSessionId) || taskManager.getTasksBySession(effectiveSessionId).some(task => task.status === 'pending' || task.status === 'running')) {
      res.status(409).json({ error: 'A task is already running in this session' });
      return;
    }
    busySessions.add(effectiveSessionId);
    const releaseSession = () => busySessions.delete(effectiveSessionId);
    res.once('finish', releaseSession);
    res.once('close', releaseSession);

    if (!messages?.length) {
      log.warn('Chat request rejected: no messages');
      res.status(400).json({ error: 'messages are required' });
      return;
    }

    let projectInfo: { uuid: string; name: string; type: 'static' | 'php' | 'node'; publicUrl: string } | undefined;
    let workspaceProfile: 'development' | 'word' = 'development';

    if (effectiveSessionId) {
      try {
        const wordWorkspace = wordWorkspacesRepo.findBySessionId(effectiveSessionId);
        if (wordWorkspace && wordWorkspace.userId === userId) {
          const wordDir = resolveUserWorkspacePath(username, 'Word', { allowRoot: true });
          mkdirSync(wordDir, { recursive: true });
          workspaceDir = wordDir;
          workspaceProfile = 'word';
          log.info('Using dedicated Word workspace directory', { sessionId: effectiveSessionId, workspaceDir });
        }
        const projectRow = db.prepare('SELECT * FROM projects WHERE session_id = ?').get(effectiveSessionId) as any;
        if (workspaceProfile !== 'word' && projectRow && projectRow.folder_path) {
          const projectDir = resolveUserWorkspacePath(username, projectRow.folder_path, { allowRoot: true });
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
        log.error('Failed to resolve project workspace', { error: err.message });
        res.status(500).json({ error: 'Failed to resolve the project workspace' });
        return;
      }
    }

    // Persist incoming messages to the database. Only user/assistant/tool roles
    // are accepted; `system` messages are reserved for internal summary injection
    // and never come from a legitimate client. The frontend injects `system`
    // entries as local UI notices (slash commands, upload feedback) — strip
    // them with a warning rather than failing the whole request, so a stray
    // client-side notice can't brick the conversation (and `system` still never
    // reaches the model or DB, preserving the injection guard).
    const allowedRoles = new Set(['user', 'assistant', 'tool']);
    for (const msg of messages) {
      if (msg.role === 'system') {
        log.warn('Stripped system message from client payload', { sessionId: effectiveSessionId });
        continue;
      }
      if (!allowedRoles.has(msg.role)) {
        log.warn('Chat rejected — invalid message role', { role: msg.role });
        res.status(400).json({ error: `Invalid message role: ${msg.role}` });
        return;
      }
    }

    const latestMessage = messages[messages.length - 1];
    if (latestMessage.role !== 'user' || !latestMessage.content.trim()) {
      res.status(400).json({ error: 'The latest message must be from the user' });
      return;
    }
    const appConfig = configRepo.getAll();
    const selectedModel = model ?? appConfig.defaultModel;
    try {
      mkdirSync(workspaceDir, { recursive: true });
    } catch (err: any) {
      res.status(500).json({ error: `Cannot prepare workspace: ${err.message}` });
      return;
    }

    // A cached/fallback model catalog cannot establish inference availability.
    // Let the actual inference request report provider errors for the selected model.

    // The payload contains conversation context; only the newest user turn is new.
    messagesRepo.create(effectiveSessionId, latestMessage.role, latestMessage.content);

    try {
      const didCompact = await compactionService.autoCompactIfNeeded(effectiveSessionId, selectedModel);
      if (didCompact) {
        log.info('Auto-compacted session before sending to agent', { sessionId: effectiveSessionId });
      }
    } catch (err: any) {
      log.warn('Auto-compaction check failed, continuing anyway', { error: err.message });
    }

    // Build the full conversation context after persisting and compacting the new turn.
    if (res.destroyed || req.aborted) return;
    const conversationContext = compactionService.getConversationContext(effectiveSessionId);

    const description = messages[messages.length - 1].content;
    log.info('Creating task for chat', { selectedModel, descriptionLength: description.length, contextLength: conversationContext.length });

    const task = taskManager.createTask(effectiveSessionId, description, selectedModel, maxSteps, userId, workspaceDir, projectInfo, conversationContext, workspaceProfile);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const keepAlive = setInterval(() => {
      if (!res.destroyed && !res.writableEnded && !res.writableNeedDrain) res.write(': keepalive\n\n');
    }, 15000);

    res.on('close', () => {
      log.info('Client disconnected, canceling task', { taskId: task.id });
      clearInterval(keepAlive);
      if (!res.writableEnded) taskManager.cancelTask(task.id);
    });

    const createdFiles = new Set<string>();
    let assistantContent = '';
    const persistedToolCalls: Array<Record<string, unknown>> = [];
    let generatedModelMessages: ModelMessage[] = [];
    let savedMessageId: string | undefined;
    const saveProgress = (status: string, error?: string) => {
      const interruption = status === 'completed' ? '' : `\n\n[Task ${status}: ${error ?? 'interrupted'}. Work is incomplete; continue from saved progress.]`;
      const content = (assistantContent || (status === 'completed' ? 'Task completed.' : '')) + interruption;
      const metadata = JSON.stringify({ model: selectedModel, taskId: task.id, status, error, calls: persistedToolCalls, createdFiles: [...createdFiles].slice(0, 5), createdFileCount: createdFiles.size });
      const modelContext = generatedModelMessages.length ? JSON.stringify(generatedModelMessages) : null;
      if (savedMessageId) {
        db.prepare('UPDATE messages SET content = ?, tool_calls = ?, model_context = ? WHERE id = ?').run(content, metadata, modelContext, savedMessageId);
      } else {
        savedMessageId = messagesRepo.create(effectiveSessionId, 'assistant', content, metadata, null, null, modelContext).id;
      }
    };

    try {
      log.info('Starting stream for task', { taskId: task.id });
      await writeSse(res, { type: 'task-start', taskId: task.id });
      const eventStream = await taskManager.streamTask(task.id);

      let totalEvents = 0;
      for await (const event of eventStream) {
        totalEvents++;
        if (event.type === 'model-messages') {
          generatedModelMessages = Array.isArray(event.messages) ? event.messages as ModelMessage[] : [];
          saveProgress('running');
          continue;
        }
        if (event.type === 'text-delta' && typeof event.content === 'string') {
          assistantContent += event.content;
        }
        if (event.type === 'tool-call') {
          persistedToolCalls.push({
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            input: compactToolValue(event.input),
            status: 'running',
          });
        }
        if (event.type === 'tool-result') {
          const index = persistedToolCalls.findIndex(call => call.toolCallId === event.toolCallId);
          const result = {
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            result: compactToolValue(event.result),
            stepNumber: event.stepNumber,
            durationMs: event.durationMs,
            status: (event.result as any)?.success === false || !!(event.result as any)?.error || ((event.result as any)?.exitCode !== undefined && (event.result as any).exitCode !== 0) ? 'error' : 'completed',
          };
          if (index >= 0) persistedToolCalls[index] = { ...persistedToolCalls[index], ...result };
          else persistedToolCalls.push(result);
        }
        if (event.type === 'tool-result' && event.toolName === 'writeFile') {
          const result = event.result as { success?: boolean; path?: unknown } | undefined;
          if (result?.success && typeof result.path === 'string') {
            createdFiles.add(result.path.replace(/\\/g, '/'));
          }
        }
        if (event.type === 'tool-result' && event.toolName === 'invokeSubAgent') {
          const result = event.result as { createdFiles?: unknown } | undefined;
          if (Array.isArray(result?.createdFiles)) {
            for (const path of result.createdFiles) {
              if (typeof path === 'string') createdFiles.add(path.replace(/\\/g, '/'));
            }
          }
        }
        if (event.type === 'tool-result') saveProgress('running');
        await writeSse(res, event);
      }

      log.info('Stream finished', { taskId: task.id, totalEvents });

      const allCreatedFiles = [...createdFiles];
      const finalTask = taskManager.getTask(task.id);
      if (finalTask?.status === 'cancelled') {
        saveProgress('cancelled');
        await writeSse(res, { type: 'cancelled', taskId: task.id });
        res.end();
        return;
      }
      if (finalTask?.status !== 'completed') throw new Error(finalTask?.error || 'Task did not complete');
      saveProgress('completed');
      await writeSse(res, {
        type: 'finish',
        taskId: task.id,
        createdFiles: allCreatedFiles.slice(0, 5),
        createdFileCount: allCreatedFiles.length,
      });
      res.end();
    } catch (err: any) {
      saveProgress(taskManager.getTask(task.id)?.status === 'cancelled' ? 'cancelled' : 'failed', err.message);
      log.error('Stream error in chat', { taskId: task.id, error: err.message, stack: err.stack });
      try {
        await writeSse(res, { type: 'error', error: err.message, taskId: task.id });
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
