import type { Server } from 'socket.io';
import type { ApprovalRequest } from '../types/index.js';

interface PendingApproval {
  resolve: (approved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();
  private io: Server | null = null;

  setIo(io: Server): void {
    this.io = io;
  }

  requestApproval(request: ApprovalRequest): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        resolve(false);
      }, 300000);

      this.pending.set(request.id, { resolve, timeout });

      if (this.io) {
        this.io.emit('approval:request', request);
      }
    });
  }

  respond(id: string, approved: boolean): void {
    const entry = this.pending.get(id);
    if (entry) {
      clearTimeout(entry.timeout);
      entry.resolve(approved);
      this.pending.delete(id);
    }
  }

  hasPending(id: string): boolean {
    return this.pending.has(id);
  }
}
