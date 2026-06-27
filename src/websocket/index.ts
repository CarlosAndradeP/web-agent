import type { Server, Socket } from 'socket.io';
import type { ApprovalManager } from '../services/approval-manager.js';
import type { TaskManager } from '../services/task-manager.js';
import type { CreditManager } from '../services/credit-manager.js';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';
import { registerSocketEvents } from './events.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('WebSocket');

declare module 'socket.io' {
  interface SocketData {
    user?: JwtPayload;
  }
}

export function setupWebSocket(io: Server, approvalManager: ApprovalManager, taskManager: TaskManager, creditManager: CreditManager): void {
  approvalManager.setIo(io);
  taskManager.setIo(io);
  creditManager.setIo(io);

  // Socket authentication middleware
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth.token ?? socket.handshake.query.token;
    if (!token || typeof token !== 'string') {
      log.warn('Socket connection rejected — no token', { socketId: socket.id });
      next(new Error('Authentication required'));
      return;
    }
    try {
      const user = verifyToken(token);
      socket.data.user = user;
      log.info('Socket authenticated', { socketId: socket.id, userId: user.userId, role: user.role });
      next();
    } catch (err: any) {
      log.warn('Socket authentication failed', { socketId: socket.id, error: err.message });
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    log.info('Client connected', { socketId: socket.id, userId: user?.userId });

    registerSocketEvents(socket, io, approvalManager, taskManager);

    socket.on('disconnect', (reason) => {
      log.info('Client disconnected', { socketId: socket.id, userId: user?.userId, reason });
    });
  });

  log.info('WebSocket setup complete');
}
