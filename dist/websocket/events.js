import { createLogger } from '../services/logger.js';
const log = createLogger('WebSocket:Events');
export function registerSocketEvents(socket, io, approvalManager, taskManager, orchestratorSessionsRepo) {
    const user = socket.data.user;
    const isAdmin = user?.role === 'admin';
    socket.on('session:join', (data) => {
        log.debug('Session join', { socketId: socket.id, sessionId: data.sessionId });
        socket.join(`session:${data.sessionId}`);
    });
    socket.on('user:join', (data) => {
        // Users can only join their own room (or admin can join any)
        if (!isAdmin && data.userId !== user?.userId) {
            log.warn('User join denied — wrong user', { socketId: socket.id, requestedUserId: data.userId, actualUserId: user?.userId });
            return;
        }
        log.debug('User join', { socketId: socket.id, userId: data.userId });
        socket.join(`user:${data.userId}`);
    });
    socket.on('task:subscribe', (data) => {
        log.debug('Task subscribe', { socketId: socket.id, taskId: data.taskId });
        socket.join(`task:${data.taskId}`);
    });
    socket.on('approval:respond', (data) => {
        log.info('Approval response', { socketId: socket.id, approvalId: data.id, approved: data.approved, userId: user?.userId });
        // Only the user who owns the approval or an admin can respond
        approvalManager.respond(data.id, data.approved, user?.userId, isAdmin);
    });
    socket.on('task:cancel', (data) => {
        log.info('Task cancel via WebSocket', { socketId: socket.id, taskId: data.taskId, userId: user?.userId });
        // Check ownership — only the task owner or an admin can cancel
        if (isAdmin) {
            taskManager.cancelTask(data.taskId);
            return;
        }
        const task = taskManager.getTask(data.taskId);
        if (!task) {
            log.warn('Task cancel — task not found', { taskId: data.taskId });
            return;
        }
        if (task.userId && task.userId !== user?.userId) {
            log.warn('Task cancel denied — not owner', { taskId: data.taskId, userId: user?.userId, taskUserId: task.userId });
            return;
        }
        taskManager.cancelTask(data.taskId);
    });
    socket.on('orchestrator:subscribe', (data) => {
        if (!orchestratorSessionsRepo)
            return;
        const session = orchestratorSessionsRepo.findById(data.sessionId);
        if (!session) {
            log.warn('Orchestrator subscribe — session not found', { sessionId: data.sessionId });
            return;
        }
        if (!isAdmin && session.userId !== user?.userId) {
            log.warn('Orchestrator subscribe denied — not owner', { sessionId: data.sessionId, userId: user?.userId });
            return;
        }
        socket.join(`orchestrator:${data.sessionId}`);
        log.debug('Orchestrator subscribe', { socketId: socket.id, sessionId: data.sessionId });
    });
    socket.on('orchestrator:unsubscribe', (data) => {
        socket.leave(`orchestrator:${data.sessionId}`);
        log.debug('Orchestrator unsubscribe', { socketId: socket.id, sessionId: data.sessionId });
    });
}
//# sourceMappingURL=events.js.map