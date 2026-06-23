import { Router } from 'express';
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
export function createChatRouter(db, taskManager, creditManager) {
    const router = Router();
    const messagesRepo = new MessagesRepository(db);
    const configRepo = new ConfigRepository(db);
    const sessionsRepo = new SessionsRepository(db);
    const usersRepo = new UsersRepository(db);
    const projectsRepo = new ProjectsRepository(db);
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
                sessions = sessions.filter(s => s.user_id === userId);
            }
            if (sessions.length === 0) {
                const session = sessionsRepo.create('Default Session', config.defaultModel);
                effectiveSessionId = session.id;
                if (userId) {
                    try {
                        db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run(userId, session.id);
                    }
                    catch { }
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
                    catch { }
                }
            }
        }
        log.info('Chat request received', { sessionId: model, messageCount: messages?.length, maxSteps, userId, workspaceDir });
        if (!messages?.length) {
            log.warn('Chat request rejected: no messages');
            res.status(400).json({ error: 'messages are required' });
            return;
        }
        let projectInfo;
        if (effectiveSessionId) {
            try {
                const projectRow = db.prepare('SELECT * FROM projects WHERE session_id = ?').get(effectiveSessionId);
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
            }
            catch (err) {
                log.warn('Failed to resolve project workspace', { error: err.message });
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
        }
        catch (err) {
            log.warn('Could not validate model, proceeding anyway', { error: err.message });
        }
        log.info('Creating task for chat', { selectedModel, descriptionLength: description.length });
        const task = taskManager.createTask(effectiveSessionId, description, selectedModel, maxSteps, userId, workspaceDir, projectInfo);
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