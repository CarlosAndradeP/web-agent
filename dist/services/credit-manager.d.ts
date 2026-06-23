import type Database from 'better-sqlite3';
import { CreditsRepository } from '../db/repositories/credits.js';
import { UsersRepository } from '../db/repositories/users.js';
import type { Server } from 'socket.io';
export declare class CreditManager {
    private db;
    private creditsRepo;
    private usersRepo;
    private io;
    private modelConfigRepo;
    constructor(db: Database.Database, creditsRepo: CreditsRepository, usersRepo: UsersRepository);
    setIo(io: Server): void;
    deductCredit(userId: string, taskId: string, costPerStep?: number): void;
    getCostPerStep(modelId: string): number;
    getBalance(userId: string): number;
    hasCredits(userId: string): boolean;
}
//# sourceMappingURL=credit-manager.d.ts.map