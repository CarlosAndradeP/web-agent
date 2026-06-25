import { TasksRepository } from '../db/repositories/tasks.js';
import { createAgent } from '../agent/index.js';
import { ConfigRepository } from '../db/repositories/config.js';
import { createLogger } from '../services/logger.js';
import { v4 as uuid } from 'uuid';
const log = createLogger('TaskManager');
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
    createTask(sessionId, description, model, maxSteps, userId, workspaceDir, projectInfo) {
        log.info('Creating task', { sessionId, description: description.slice(0, 100), model, maxSteps, userId });
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
        const abortController = new AbortController();
        this.activeControllers.set(taskId, abortController);
        log.info('Running task (non-streaming)', { taskId, model, maxSteps: task.maxSteps });
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
            });
            const self = this;
            const creditManager = this.creditManager;
            const costPerStep = creditManager.getCostPerStep(model);
            const result = await agent.generate({
                prompt: task.description,
                abortSignal,
                onStepFinish: async ({ stepNumber, toolCalls, toolResults }) => {
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
                },
            });
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
        const abortController = new AbortController();
        this.activeControllers.set(taskId, abortController);
        log.info('Streaming task', { taskId, model, maxSteps: task.maxSteps, sessionId: task.sessionId });
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
        });
        log.info('Agent created, calling stream()...', { taskId, model });
        const costPerStep = this.creditManager.getCostPerStep(model);
        try {
            const streamResult = await agent.stream({
                prompt: task.description,
                abortSignal,
                onStepFinish: async ({ stepNumber, toolCalls, toolResults }) => {
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
                },
            });
            log.info('Agent stream obtained, returning fullStream', { taskId });
            const tasksRepo = this.tasksRepo;
            const activeControllers = this.activeControllers;
            const taskProjectInfo = this.taskProjectInfo;
            const taskUserIds = this.taskUserIds;
            const insertStep = this.insertStep.bind(this);
            const emitToTaskUser = this.emitToTaskUser.bind(this);
            const fullStream = streamResult.fullStream;
            async function* eventStream() {
                let stepNumber = 0;
                let toolName = null;
                let toolInput = null;
                let stepStartTime = Date.now();
                try {
                    for await (const chunk of fullStream) {
                        const chunkType = chunk.type;
                        if (chunkType === 'text-delta') {
                            const text = chunk.text ?? '';
                            if (text) {
                                yield { type: 'text-delta', taskId, content: text };
                            }
                        }
                        else if (chunkType === 'tool-call') {
                            toolName = chunk.toolName;
                            toolInput = JSON.stringify(chunk.input ?? {}).slice(0, 5000);
                            yield {
                                type: 'tool-call',
                                taskId,
                                toolName,
                                toolCallId: chunk.toolCallId,
                                input: chunk.input,
                            };
                        }
                        else if (chunkType === 'tool-result') {
                            const durationMs = Date.now() - stepStartTime;
                            stepNumber++;
                            const output = JSON.stringify(chunk.output ?? {}).slice(0, 5000);
                            insertStep(taskId, stepNumber, toolName, toolInput, output, durationMs);
                            yield {
                                type: 'tool-result',
                                taskId,
                                toolName: toolName ?? 'unknown',
                                toolCallId: chunk.toolCallId,
                                result: chunk.output,
                                stepNumber,
                                durationMs,
                            };
                            toolName = null;
                            toolInput = null;
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
                        else if (chunkType === 'finish' || chunkType === 'error' || chunkType === 'abort') {
                            // handled below
                        }
                    }
                    tasksRepo.updateStatus(taskId, 'completed');
                    emitToTaskUser(taskId, 'task:completed', { taskId });
                    log.info('Stream completed', { taskId, totalSteps: stepNumber });
                }
                catch (err) {
                    tasksRepo.updateStatus(taskId, 'failed', null, err.message);
                    emitToTaskUser(taskId, 'task:failed', { taskId, error: err.message });
                    log.error('Stream error', { taskId, error: err.message, stack: err.stack });
                    yield { type: 'error', taskId, error: err.message };
                    throw err;
                }
                finally {
                    activeControllers.delete(taskId);
                    taskProjectInfo.delete(taskId);
                    taskUserIds.delete(taskId);
                }
            }
            return eventStream();
        }
        catch (err) {
            this.activeControllers.delete(taskId);
            this.taskProjectInfo.delete(taskId);
            this.taskUserIds.delete(taskId);
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
            controller.abort();
            this.tasksRepo.updateStatus(taskId, 'cancelled');
            this.activeControllers.delete(taskId);
            this.taskUserIds.delete(taskId);
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