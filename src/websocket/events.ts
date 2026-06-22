import type { Socket, Server } from 'socket.io';
import type { ApprovalManager } from '../services/approval-manager.js';
import type { TaskManager } from '../services/task-manager.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('WebSocket:Events');

export function registerSocketEvents(socket: Socket, io: Server, approvalManager: ApprovalManager, taskManager: TaskManager) {
  socket.on('session:join', (data: { sessionId: string }) => {
    log.debug('Session join', { socketId: socket.id, sessionId: data.sessionId });
    socket.join(`session:${data.sessionId}`);
  });

  socket.on('user:join', (data: { userId: string }) => {
    log.debug('User join', { socketId: socket.id, userId: data.userId });
    socket.join(`user:${data.userId}`);
  });

  socket.on('task:subscribe', (data: { taskId: string }) => {
    log.debug('Task subscribe', { socketId: socket.id, taskId: data.taskId });
    socket.join(`task:${data.taskId}`);
  });

  socket.on('approval:respond', (data: { id: string; approved: boolean }) => {
    log.info('Approval response', { socketId: socket.id, approvalId: data.id, approved: data.approved });
    approvalManager.respond(data.id, data.approved);
  });

  socket.on('task:cancel', (data: { taskId: string }) => {
    log.info('Task cancel via WebSocket', { socketId: socket.id, taskId: data.taskId });
    taskManager.cancelTask(data.taskId);
  });
}
