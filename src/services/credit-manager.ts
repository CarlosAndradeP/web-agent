import type Database from 'better-sqlite3';
import { CreditsRepository } from '../db/repositories/credits.js';
import { UsersRepository } from '../db/repositories/users.js';
import { ModelConfigRepository } from '../db/repositories/model-config.js';
import type { Server } from 'socket.io';
import { createLogger } from '../services/logger.js';

const log = createLogger('CreditManager');

export class CreditManager {
  private io: Server | null = null;
  private modelConfigRepo: ModelConfigRepository;

  constructor(
    private db: Database.Database,
    private creditsRepo: CreditsRepository,
    private usersRepo: UsersRepository,
  ) {
    this.modelConfigRepo = new ModelConfigRepository(db);
  }

  setIo(io: Server): void {
    this.io = io;
  }

  deductCredit(userId: string, taskId: string, costPerStep: number = 1): void {
    const amount = Math.max(1, Math.round(costPerStep));

    try {
      this.creditsRepo.deduct(userId, amount, 'consumption', `Step in task ${taskId}`, taskId);
    } catch (err: any) {
      if (err.message === 'Insufficient credits') {
        log.warn('Credits exhausted', { userId, taskId });
        if (this.io) {
          this.io.to(`user:${userId}`).emit('credits:exhausted', { userId, taskId });
        }
        throw new Error('Credits exhausted. Please contact admin to add more credits.');
      }
      throw err;
    }

    const newBalance = this.creditsRepo.getBalance(userId);
    log.info('Credit deducted', { userId, taskId, amount, newBalance });

    if (this.io) {
      this.io.to(`user:${userId}`).emit('credits:deducted', { userId, taskId, newBalance, deducted: amount });
    }

    if (newBalance <= 0) {
      log.warn('Credits now exhausted', { userId, taskId });
      if (this.io) {
        this.io.to(`user:${userId}`).emit('credits:exhausted', { userId, taskId });
      }
    }
  }

  getCostPerStep(modelId: string): number {
    return this.modelConfigRepo.getCostPerStep(modelId);
  }

  getBalance(userId: string): number {
    return this.creditsRepo.getBalance(userId);
  }

  hasCredits(userId: string): boolean {
    return this.creditsRepo.getBalance(userId) > 0;
  }
}
