import { TasksRepository } from '../db/repositories/tasks.js';
import { createAgent } from '../agent/index.js';
import { ConfigRepository } from '../db/repositories/config.js';
import { createLogger } from '../services/logger.js';
import { v4 as uuid } from 'uuid';
const log = createLogger('TaskManager');
function streamChunkError(value) {
    if (value instanceof Error)
        return value;
    if (typeof value === 'string' && value.trim())
        return new Error(value);
    return new Error('Agent stream failed');
}
export class TaskManager {
    db;
    tasksRepo;
    configRepo;
    creditManager;
    approvalManager;
    io = null;
    activeControllers = new Map();
    taskProjectInfo = new Map();
    taskUserIds = new Map();
    taskConversationContext = new Map();
    taskWorkspaceProfiles = new Map();
    constructor(db, creditManager, approvalManager) {
        this.db = db;
        this.tasksRepo = new TasksRepository(db);
        this.configRepo = new ConfigRepository(db);
        this.creditManager = creditManager;
        this.approvalManager = approvalManager ?? null;
    }
    emitToTaskUser(taskId, event, data) {
        if (!this.io)
            return;
        const userId = this.taskUserIds.get(taskId);
        const emitter = userId ? this.io.to(`user:${userId}`) : this.io;
        emitter.emit(event, data);
    }
    insertStep(taskId, stepNumber, toolName, toolInput, toolOutput, durationMs) {
        const id = uuid();
        const now = new Date().toISOString();
        try {
            this.db.prepare('INSERT INTO agent_steps (id, task_id, step_number, tool_name, tool_input, tool_output, reasoning, duration_ms, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)').run(id, taskId, stepNumber, toolName, toolInput, toolOutput, durationMs, 'success', now);
        }
        catch (err) {
            log.warn('Failed to insert agent step', { taskId, stepNumber, error: err.message });
        }
    }
    setIo(io) {
        this.io = io;
        log.info('Socket.IO instance set');
    }
    createTask(sessionId, description, model, maxSteps, userId, workspaceDir, projectInfo, conversationContext, workspaceProfile = 'development') {
        log.info('Creating task', { sessionId, description: description.slice(0, 100), model, maxSteps, userId, contextLength: conversationContext?.length });
        const task = this.tasksRepo.create(sessionId, description, model, maxSteps);
        if (userId) {
            this.taskUserIds.set(task.id, userId);
            try {
                this.db.prepare('UPDATE tasks SET user_id = ?, workspace_dir = ? WHERE id = ?').run(userId, workspaceDir ?? null, task.id);
            }
            catch (err) {
                log.warn('Failed to set task user_id', { taskId: task.id, error: err.message });
            }
        }
        if (projectInfo) {
            this.taskProjectInfo.set(task.id, projectInfo);
        }
        if (conversationContext && conversationContext.length > 0) {
            this.taskConversationContext.set(task.id, conversationContext);
        }
        this.taskWorkspaceProfiles.set(task.id, workspaceProfile);
        if (this.io) {
            const room = userId ? `user:${userId}` : undefined;
            const emitter = room ? this.io.to(room) : this.io;
            emitter.emit('task:created', { task });
        }
        log.info('Task created', { taskId: task.id, status: task.status });
        return task;
    }
    async runTask(taskId) {
        const task = this.tasksRepo.findById(taskId);
        if (!task) {
            log.error('Task not found', { taskId });
            throw new Error('Task not found');
        }
        this.tasksRepo.updateStatus(taskId, 'running');
        const appConfig = this.configRepo.getAll();
        const model = task.model ?? appConfig.defaultModel;
        const workspaceDir = task.workspaceDir ?? appConfig.workspaceDir;
        const userId = task.userId;
        const projectInfo = this.taskProjectInfo.get(taskId) ?? undefined;
        const conversationContext = this.taskConversationContext.get(taskId) ?? undefined;
        const workspaceProfile = this.taskWorkspaceProfiles.get(taskId) ?? 'development';
        const abortController = new AbortController();
        this.activeControllers.set(taskId, abortController);
        log.info('Running task (non-streaming)', { taskId, model, maxSteps: task.maxSteps, hasContext: !!conversationContext });
        try {
            const { agent, abortSignal } = createAgent({
                model,
                maxSteps: task.maxSteps,
                sessionId: task.sessionId,
                workspaceDir,
                approvalMode: appConfig.approvalMode,
                approvalTools: appConfig.approvalTools,
                apiBaseUrl: appConfig.apiBaseUrl,
                apiKey: appConfig.apiKey,
                agentType: appConfig.agentType,
                abortSignal: abortController.signal,
                projectInfo,
                approvalManager: this.approvalManager ?? undefined,
                userId,
                conversationContext,
                workspaceProfile,
            });
            const self = this;
            const creditManager = this.creditManager;
            const costPerStep = creditManager.getCostPerStep(model);
            const stepCallback = async ({ stepNumber, toolCalls, toolResults }) => {
                self.tasksRepo.incrementStep(taskId);
                if (this.io) {
                    this.emitToTaskUser(taskId, 'task:step', { taskId, stepNumber, toolCalls: toolCalls?.map((tc) => tc.toolName) });
                }
                if (userId && toolResults?.length) {
                    try {
                        creditManager.deductCredit(userId, taskId, costPerStep);
                    }
                    catch (creditErr) {
                        log.warn('Credit deduction failed, aborting task', { taskId, error: creditErr.message });
                        abortController.abort();
                    }
                }
            };
            // Use messages array if we have conversation context, otherwise fall back to single prompt
            const result = conversationContext && conversationContext.length > 0
                ? await agent.generate({ messages: conversationContext, abortSignal, onStepFinish: stepCallback })
                : await agent.generate({ prompt: task.description, abortSignal, onStepFinish: stepCallback });
            const text = result.text ?? 'Task completed';
            this.tasksRepo.updateStatus(taskId, 'completed', text);
            this.emitToTaskUser(taskId, 'task:completed', { taskId, result: text });
            log.info('Task completed', { taskId, resultLength: text.length });
        }
        catch (err) {
            this.tasksRepo.updateStatus(taskId, 'failed', null, err.message);
            this.emitToTaskUser(taskId, 'task:failed', { taskId, error: err.message });
            log.error('Task failed', { taskId, error: err.message, stack: err.stack });
        }
        finally {
            this.activeControllers.delete(taskId);
            this.taskProjectInfo.delete(taskId);
            this.taskUserIds.delete(taskId);
            this.taskConversationContext.delete(taskId);
            this.taskWorkspaceProfiles.delete(taskId);
        }
    }
    async streamTask(taskId) {
        const task = this.tasksRepo.findById(taskId);
        if (!task) {
            log.error('Task not found for streaming', { taskId });
            throw new Error('Task not found');
        }
        this.tasksRepo.updateStatus(taskId, 'running');
        const appConfig = this.configRepo.getAll();
        const model = task.model ?? appConfig.defaultModel;
        const workspaceDir = task.workspaceDir ?? appConfig.workspaceDir;
        const userId = task.userId;
        const projectInfo = this.taskProjectInfo.get(taskId) ?? undefined;
        const conversationContext = this.taskConversationContext.get(taskId) ?? undefined;
        const workspaceProfile = this.taskWorkspaceProfiles.get(taskId) ?? 'development';
        const abortController = new AbortController();
        this.activeControllers.set(taskId, abortController);
        log.info('Streaming task', { taskId, model, maxSteps: task.maxSteps, sessionId: task.sessionId, hasContext: !!conversationContext });
        const { agent, abortSignal } = createAgent({
            model,
            maxSteps: task.maxSteps,
            sessionId: task.sessionId,
            workspaceDir,
            approvalMode: appConfig.approvalMode,
            approvalTools: appConfig.approvalTools,
            apiBaseUrl: appConfig.apiBaseUrl,
            apiKey: appConfig.apiKey,
            agentType: appConfig.agentType,
            abortSignal: abortController.signal,
            projectInfo,
            approvalManager: this.approvalManager ?? undefined,
            userId,
            conversationContext,
            workspaceProfile,
        });
        log.info('Agent created, calling stream()...', { taskId, model });
        const costPerStep = this.creditManager.getCostPerStep(model);
        const stepCallback = async ({ stepNumber, toolCalls, toolResults }) => {
            this.tasksRepo.incrementStep(taskId);
            this.emitToTaskUser(taskId, 'task:step', { taskId, stepNumber, toolCalls: toolCalls?.map((tc) => tc.toolName) });
            if (userId && toolResults?.length) {
                try {
                    this.creditManager.deductCredit(userId, taskId, costPerStep);
                }
                catch (creditErr) {
                    log.warn('Credit deduction failed, aborting task', { taskId, error: creditErr.message });
                    abortController.abort();
                }
            }
        };
        try {
            // Use messages array if we have conversation context, otherwise fall back to single prompt
            const streamResult = conversationContext && conversationContext.length > 0
                ? await agent.stream({ messages: conversationContext, abortSignal, onStepFinish: stepCallback })
                : await agent.stream({ prompt: task.description, abortSignal, onStepFinish: stepCallback });
            log.info('Agent stream obtained, returning fullStream', { taskId });
            const tasksRepo = this.tasksRepo;
            const activeControllers = this.activeControllers;
            const taskProjectInfo = this.taskProjectInfo;
            const taskUserIds = this.taskUserIds;
            const taskConversationContext = this.taskConversationContext;
            const taskWorkspaceProfiles = this.taskWorkspaceProfiles;
            const insertStep = this.insertStep.bind(this);
            const emitToTaskUser = this.emitToTaskUser.bind(this);
            const fullStream = streamResult.fullStream;
            async function* eventStream() {
                let stepNumber = 0;
                let stepStartTime = Date.now();
                let sawFinish = false;
                let sawAbort = false;
                const pendingTools = new Map();
                try {
                    for await (const chunk of fullStream) {
                        // Check if task was cancelled between chunks
                        if (abortSignal?.aborted) {
                            log.info('Stream aborted by signal', { taskId });
                            break;
                        }
                        const chunkType = chunk.type;
                        if (chunkType === 'text-delta') {
                            const text = chunk.text ?? '';
                            if (text) {
                                yield { type: 'text-delta', taskId, content: text };
                            }
                        }
                        else if (chunkType === 'tool-call') {
                            const toolCallId = chunk.toolCallId;
                            const toolName = chunk.toolName;
                            const toolInput = JSON.stringify(chunk.input ?? {}).slice(0, 5000);
                            pendingTools.set(toolCallId, { toolName, toolInput, startedAt: Date.now() });
                            yield {
                                type: 'tool-call',
                                taskId,
                                toolName,
                                toolCallId,
                                input: chunk.input,
                            };
                        }
                        else if (chunkType === 'tool-result') {
                            const toolCallId = chunk.toolCallId;
                            const pendingTool = pendingTools.get(toolCallId);
                            const durationMs = Date.now() - (pendingTool?.startedAt ?? stepStartTime);
                            stepNumber++;
                            const output = JSON.stringify(chunk.output ?? {}).slice(0, 5000);
                            insertStep(taskId, stepNumber, pendingTool?.toolName ?? null, pendingTool?.toolInput ?? null, output, durationMs);
                            yield {
                                type: 'tool-result',
                                taskId,
                                toolName: pendingTool?.toolName ?? 'unknown',
                                toolCallId,
                                result: chunk.output,
                                stepNumber,
                                durationMs,
                            };
                            pendingTools.delete(toolCallId);
                            stepStartTime = Date.now();
                        }
                        else if (chunkType === 'start-step') {
                            stepStartTime = Date.now();
                            yield {
                                type: 'step-start',
                                taskId,
                                stepNumber: stepNumber + 1,
                            };
                        }
                        else if (chunkType === 'finish-step') {
                            yield {
                                type: 'step-end',
                                taskId,
                                stepNumber,
                            };
                        }
                        else if (chunkType === 'finish') {
                            sawFinish = true;
                        }
                        else if (chunkType === 'abort') {
                            sawAbort = true;
                        }
                        else if (chunkType === 'error') {
                            // streamText reports terminal provider failures as data chunks
                            // instead of rejecting the iterator. Ignoring this used to make
                            // exhausted 429 retries look like successful task completion.
                            throw streamChunkError(chunk.error);
                        }
                    }
                    // If the stream exited via abort (not natural finish), mark the task
                    // cancelled rather than completed. Otherwise the cancelTask call and
                    // the generator finally race, and the status ends up 'completed' for a
                    // task the user explicitly stopped.
                    if (abortSignal?.aborted || sawAbort) {
                        const wasAlreadyCancelled = tasksRepo.findById(taskId)?.status === 'cancelled';
                        tasksRepo.updateStatus(taskId, 'cancelled');
                        if (!wasAlreadyCancelled)
                            emitToTaskUser(taskId, 'task:cancelled', { taskId });
                        log.info('Stream cancelled by signal', { taskId, totalSteps: stepNumber });
                    }
                    else if (sawFinish) {
                        tasksRepo.updateStatus(taskId, 'completed');
                        emitToTaskUser(taskId, 'task:completed', { taskId });
                        log.info('Stream completed', { taskId, totalSteps: stepNumber });
                    }
                    else {
                        throw new Error('Agent stream ended without a finish event');
                    }
                }
                catch (err) {
                    tasksRepo.updateStatus(taskId, 'failed', null, err.message);
                    emitToTaskUser(taskId, 'task:failed', { taskId, error: err.message });
                    log.error('Stream error', { taskId, error: err.message, stack: err.stack });
                    throw err;
                }
                finally {
                    activeControllers.delete(taskId);
                    taskProjectInfo.delete(taskId);
                    taskUserIds.delete(taskId);
                    taskConversationContext.delete(taskId);
                    taskWorkspaceProfiles.delete(taskId);
                }
            }
            return eventStream();
        }
        catch (err) {
            this.activeControllers.delete(taskId);
            this.taskProjectInfo.delete(taskId);
            this.taskUserIds.delete(taskId);
            this.taskConversationContext.delete(taskId);
            this.taskWorkspaceProfiles.delete(taskId);
            this.tasksRepo.updateStatus(taskId, 'failed', null, err.message);
            this.emitToTaskUser(taskId, 'task:failed', { taskId, error: err.message });
            log.error('Failed to create agent stream', { taskId, error: err.message, stack: err.stack });
            throw err;
        }
    }
    cancelTask(taskId) {
        log.info('Canceling task', { taskId });
        const controller = this.activeControllers.get(taskId);
        if (controller) {
            const wasAlreadyCancelled = this.tasksRepo.findById(taskId)?.status === 'cancelled';
            controller.abort();
            // Emit BEFORE deleting taskUserIds: emitToTaskUser looks up the userId
            // entry to scope the broadcast to the owner's socket room. Deleting
            // first would make the emit fall back to a global broadcast, leaking the
            // event to every connected user.
            this.tasksRepo.updateStatus(taskId, 'cancelled');
            if (!wasAlreadyCancelled)
                this.emitToTaskUser(taskId, 'task:cancelled', { taskId });
            log.info('Task canceled', { taskId });
        }
        else {
            log.warn('No active controller for task cancel', { taskId });
        }
    }
    getTasks() {
        return this.tasksRepo.list();
    }
    getTask(id) {
        return this.tasksRepo.findById(id);
    }
    getTasksBySession(sessionId) {
        return this.tasksRepo.findBySession(sessionId);
    }
}
//# sourceMappingURL=task-manager.js.map