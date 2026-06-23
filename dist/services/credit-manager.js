import { ModelConfigRepository } from '../db/repositories/model-config.js';
import { createLogger } from '../services/logger.js';
const log = createLogger('CreditManager');
export class CreditManager {
    db;
    creditsRepo;
    usersRepo;
    io = null;
    modelConfigRepo;
    constructor(db, creditsRepo, usersRepo) {
        this.db = db;
        this.creditsRepo = creditsRepo;
        this.usersRepo = usersRepo;
        this.modelConfigRepo = new ModelConfigRepository(db);
    }
    setIo(io) {
        this.io = io;
    }
    deductCredit(userId, taskId, costPerStep = 1) {
        const balance = this.creditsRepo.getBalance(userId);
        if (balance <= 0) {
            log.warn('Credits exhausted', { userId, taskId });
            if (this.io) {
                this.io.to(`user:${userId}`).emit('credits:exhausted', { userId, taskId });
            }
            throw new Error('Credits exhausted. Please contact admin to add more credits.');
        }
        const amount = Math.max(1, Math.round(costPerStep));
        this.creditsRepo.deduct(userId, amount, 'consumption', `Step in task ${taskId}`, taskId);
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
    getCostPerStep(modelId) {
        return this.modelConfigRepo.getCostPerStep(modelId);
    }
    getBalance(userId) {
        return this.creditsRepo.getBalance(userId);
    }
    hasCredits(userId) {
        return this.creditsRepo.getBalance(userId) > 0;
    }
}
//# sourceMappingURL=credit-manager.js.map