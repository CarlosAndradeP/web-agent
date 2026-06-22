import type { Server } from 'socket.io';
import type { ApprovalManager } from '../services/approval-manager.js';
import type { TaskManager } from '../services/task-manager.js';
import { registerSocketEvents } from './events.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('WebSocket');

export function setupWebSocket(io: Server, approvalManager: ApprovalManager, taskManager: TaskManager): void {
  approvalManager.setIo(io);
  taskManager.setIo(io);

  io.on('connection', (socket) => {
    log.info('Client connected', { socketId: socket.id });
    registerSocketEvents(socket, io, approvalManager, taskManager);

    socket.on('disconnect', (reason) => {
      log.info('Client disconnected', { socketId: socket.id, reason });
    });
  });

  log.info('WebSocket setup complete');
}
