import type { Server } from 'socket.io';
import type { ApprovalManager } from '../services/approval-manager.js';
import type { TaskManager } from '../services/task-manager.js';
import { registerSocketEvents } from './events.js';

export function setupWebSocket(io: Server, approvalManager: ApprovalManager, taskManager: TaskManager): void {
  approvalManager.setIo(io);
  taskManager.setIo(io);

  io.on('connection', (socket) => {
    registerSocketEvents(socket, io, approvalManager, taskManager);
  });
}
