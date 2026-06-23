import { createLogger } from '../services/logger.js';
const log = createLogger('WebSocket:Events');
export function registerSocketEvents(socket, io, approvalManager, taskManager) {
    socket.on('session:join', (data) => {
        log.debug('Session join', { socketId: socket.id, sessionId: data.sessionId });
        socket.join(`session:${data.sessionId}`);
    });
    socket.on('user:join', (data) => {
        log.debug('User join', { socketId: socket.id, userId: data.userId });
        socket.join(`user:${data.userId}`);
    });
    socket.on('task:subscribe', (data) => {
        log.debug('Task subscribe', { socketId: socket.id, taskId: data.taskId });
        socket.join(`task:${data.taskId}`);
    });
    socket.on('approval:respond', (data) => {
        log.info('Approval response', { socketId: socket.id, approvalId: data.id, approved: data.approved });
        approvalManager.respond(data.id, data.approved);
    });
    socket.on('task:cancel', (data) => {
        log.info('Task cancel via WebSocket', { socketId: socket.id, taskId: data.taskId });
        taskManager.cancelTask(data.taskId);
    });
}
//# sourceMappingURL=events.js.map