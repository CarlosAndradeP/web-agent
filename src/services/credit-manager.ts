import type Database from 'better-sqlite3';
import { CreditsRepository } from '../db/repositories/credits.js';
import { UsersRepository } from '../db/repositories/users.js';
import type { Server } from 'socket.io';
import { createLogger } from '../services/logger.js';

const log = createLogger('CreditManager');

export class CreditManager {
  private io: Server | null = null;

  constructor(
    private db: Database.Database,
    private creditsRepo: CreditsRepository,
    private usersRepo: UsersRepository,
  ) {}

  setIo(io: Server): void {
    this.io = io;
  }

  deductCredit(userId: string, taskId: string): void {
    const balance = this.creditsRepo.getBalance(userId);
    if (balance <= 0) {
      log.warn('Credits exhausted', { userId, taskId });
      if (this.io) {
        this.io.emit('credits:exhausted', { userId, taskId });
      }
      throw new Error('Credits exhausted. Please contact admin to add more credits.');
    }

    this.creditsRepo.deduct(userId, 1, 'consumption', `Step in task ${taskId}`, taskId);
    const newBalance = this.creditsRepo.getBalance(userId);
    log.info('Credit deducted', { userId, taskId, newBalance });

    if (this.io) {
      this.io.emit('credits:deducted', { userId, taskId, newBalance, deducted: 1 });
    }

    if (newBalance <= 0) {
      log.warn('Credits now exhausted', { userId, taskId });
      if (this.io) {
        this.io.emit('credits:exhausted', { userId, taskId });
      }
    }
  }

  getBalance(userId: string): number {
    return this.creditsRepo.getBalance(userId);
  }

  hasCredits(userId: string): boolean {
    return this.creditsRepo.getBalance(userId) > 0;
  }
}
