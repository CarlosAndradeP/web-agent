import type { Server } from 'socket.io';
import type { ApprovalRequest } from '../types/index.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('ApprovalManager');

interface PendingApproval {
  resolve: (approved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();
  private io: Server | null = null;

  setIo(io: Server): void {
    this.io = io;
    log.info('Socket.IO instance set');
  }

  requestApproval(request: ApprovalRequest): Promise<boolean> {
    log.info('Approval requested', { id: request.id, toolName: request.toolName });
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        log.warn('Approval timed out (5min)', { id: request.id });
        resolve(false);
      }, 300000);

      this.pending.set(request.id, { resolve, timeout });

      if (this.io) {
        this.io.emit('approval:request', request);
        log.info('Approval request emitted via Socket.IO', { id: request.id });
      } else {
        log.warn('No Socket.IO instance, approval request not sent to client', { id: request.id });
      }
    });
  }

  respond(id: string, approved: boolean): void {
    const entry = this.pending.get(id);
    if (entry) {
      clearTimeout(entry.timeout);
      entry.resolve(approved);
      this.pending.delete(id);
      log.info('Approval responded', { id, approved });
    } else {
      log.warn('No pending approval found for response', { id });
    }
  }

  hasPending(id: string): boolean {
    return this.pending.has(id);
  }
}
