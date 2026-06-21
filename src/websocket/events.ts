import type { Socket, Server } from 'socket.io';
import type { ApprovalManager } from '../services/approval-manager.js';
import type { TaskManager } from '../services/task-manager.js';

export function registerSocketEvents(socket: Socket, io: Server, approvalManager: ApprovalManager, taskManager: TaskManager) {
  socket.on('session:join', (data: { sessionId: string }) => {
    socket.join(`session:${data.sessionId}`);
  });

  socket.on('task:subscribe', (data: { taskId: string }) => {
    socket.join(`task:${data.taskId}`);
  });

  socket.on('approval:respond', (data: { id: string; approved: boolean }) => {
    approvalManager.respond(data.id, data.approved);
  });

  socket.on('task:cancel', (data: { taskId: string }) => {
    taskManager.cancelTask(data.taskId);
  });
}
