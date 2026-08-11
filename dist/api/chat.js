import { Router } from 'express';
import { MessagesRepository } from '../db/repositories/messages.js';
import { ConfigRepository } from '../db/repositories/config.js';
import { SessionsRepository } from '../db/repositories/sessions.js';
import { UsersRepository } from '../db/repositories/users.js';
import { ProjectsRepository } from '../db/repositories/projects.js';
import { WordWorkspacesRepository } from '../db/repositories/word-workspaces.js';
import { resolveModels } from '../services/model-resolver.js';
import { config } from '../config.js';
import { mkdirSync } from 'node:fs';
import { createLogger } from '../services/logger.js';
import { getUserWorkspaceDir, resolveUserWorkspacePath } from '../lib/workspace-paths.js';
const log = createLogger('ChatAPI');
function compactToolValue(value) {
    try {
        const serialized = JSON.stringify(value);
        return serialized.length > 5000 ? `${serialized.slice(0, 5000)}...` : value;
    }
    catch {
        return String(value);
    }
}
export function createChatRouter(db, taskManager, creditManager, compactionService) {
    const router = Router();
    const messagesRepo = new MessagesRepository(db);
    const configRepo = new ConfigRepository(db);
    const sessionsRepo = new SessionsRepository(db);
    const usersRepo = new UsersRepository(db);
    const projectsRepo = new ProjectsRepository(db);
    const wordWorkspacesRepo = new WordWorkspacesRepository(db);
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
        }
        catch (err) {
            log.error('Compaction failed', { sessionId, error: err.message });
            res.status(500).json({ error: `Compaction failed: ${err.message}` });
        }
    });
    router.post('/', async (req, res) => {
        const { sessionId, model, messages, maxSteps } = req.body;
        const userId = req.user?.userId;
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
                    }
                    catch (err) {
                        log.error('Failed to assign session owner', { sessionId: session.id, userId, error: err.message });
                    }
                }
            }
            else {
                effectiveSessionId = sessions[0].id;
            }
            log.info('Session resolved', { effectiveSessionId });
        }
        else {
            const existing = sessionsRepo.findById(effectiveSessionId);
            if (!existing) {
                log.warn('Session not found, creating new', { sessionId: effectiveSessionId });
                const session = sessionsRepo.create('Default Session', config.defaultModel);
                effectiveSessionId = session.id;
                if (userId) {
                    try {
                        db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run(userId, session.id);
                    }
                    catch (err) {
                        log.error('Failed to assign session owner', { sessionId: session.id, userId, error: err.message });
                    }
                }
            }
            else {
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
        if (!messages?.length) {
            log.warn('Chat request rejected: no messages');
            res.status(400).json({ error: 'messages are required' });
            return;
        }
        let projectInfo;
        let workspaceProfile = 'development';
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
                const projectRow = db.prepare('SELECT * FROM projects WHERE session_id = ?').get(effectiveSessionId);
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
            }
            catch (err) {
                log.warn('Failed to resolve project workspace', { error: err.message });
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
        if (latestMessage.role !== 'user') {
            res.status(400).json({ error: 'The latest message must be from the user' });
            return;
        }
        const appConfig = configRepo.getAll();
        const selectedModel = model ?? appConfig.defaultModel;
        try {
            const availableModels = await resolveModels(appConfig.apiBaseUrl);
            if (!availableModels.find(m => m.id === selectedModel)) {
                log.warn('Requested model not available, using first available', { selectedModel, fallback: availableModels[0]?.id });
                if (availableModels.length > 0) {
                    res.status(400).json({ error: `Model "${selectedModel}" is not available. Available models: ${availableModels.map(m => m.id).join(', ')}` });
                    return;
                }
            }
        }
        catch (err) {
            log.warn('Could not validate model, proceeding anyway', { error: err.message });
        }
        // The payload contains conversation context; only the newest user turn is new.
        messagesRepo.create(effectiveSessionId, latestMessage.role, latestMessage.content);
        try {
            const didCompact = await compactionService.autoCompactIfNeeded(effectiveSessionId, selectedModel);
            if (didCompact) {
                log.info('Auto-compacted session before sending to agent', { sessionId: effectiveSessionId });
            }
        }
        catch (err) {
            log.warn('Auto-compaction check failed, continuing anyway', { error: err.message });
        }
        // Build the full conversation context after persisting and compacting the new turn.
        const conversationContext = compactionService.getConversationContext(effectiveSessionId);
        const description = messages[messages.length - 1].content;
        log.info('Creating task for chat', { selectedModel, descriptionLength: description.length, contextLength: conversationContext.length });
        const task = taskManager.createTask(effectiveSessionId, description, selectedModel, maxSteps, userId, workspaceDir, projectInfo, conversationContext, workspaceProfile);
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
            const createdFiles = new Set();
            let assistantContent = '';
            const persistedToolCalls = [];
            for await (const event of eventStream) {
                totalEvents++;
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
                        status: 'completed',
                    };
                    if (index >= 0)
                        persistedToolCalls[index] = { ...persistedToolCalls[index], ...result };
                    else
                        persistedToolCalls.push(result);
                }
                if (event.type === 'tool-result' && event.toolName === 'writeFile') {
                    const result = event.result;
                    if (result?.success && typeof result.path === 'string') {
                        createdFiles.add(result.path.replace(/\\/g, '/'));
                    }
                }
                if (event.type === 'tool-result' && event.toolName === 'invokeSubAgent') {
                    const result = event.result;
                    if (Array.isArray(result?.createdFiles)) {
                        for (const path of result.createdFiles) {
                            if (typeof path === 'string')
                                createdFiles.add(path.replace(/\\/g, '/'));
                        }
                    }
                }
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
            log.info('Stream finished', { taskId: task.id, totalEvents });
            const allCreatedFiles = [...createdFiles];
            const finalTask = taskManager.getTask(task.id);
            if (finalTask?.status === 'cancelled') {
                res.write(`data: ${JSON.stringify({ type: 'cancelled', taskId: task.id })}\n\n`);
                res.end();
                return;
            }
            const finalContent = assistantContent || 'Tarefa concluída sem uma resposta em texto.';
            messagesRepo.create(effectiveSessionId, 'assistant', finalContent, JSON.stringify({
                calls: persistedToolCalls,
                createdFiles: allCreatedFiles.slice(0, 5),
                createdFileCount: allCreatedFiles.length,
            }));
            res.write(`data: ${JSON.stringify({
                type: 'finish',
                taskId: task.id,
                createdFiles: allCreatedFiles.slice(0, 5),
                createdFileCount: allCreatedFiles.length,
            })}\n\n`);
            res.end();
        }
        catch (err) {
            log.error('Stream error in chat', { taskId: task.id, error: err.message, stack: err.stack });
            try {
                res.write(`data: ${JSON.stringify({ type: 'error', error: err.message, taskId: task.id })}\n\n`);
                res.end();
            }
            catch {
                log.error('Failed to write error to SSE response', { taskId: task.id });
                if (!res.headersSent) {
                    res.status(500).json({ error: err.message });
                }
            }
        }
        finally {
            clearInterval(keepAlive);
        }
    });
    return router;
}
//# sourceMappingURL=chat.js.map