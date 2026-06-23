import type Database from 'better-sqlite3';
export interface CreditTransaction {
    id: string;
    userId: string;
    amount: number;
    balanceAfter: number;
    type: 'purchase' | 'consumption' | 'refund' | 'bonus';
    description: string | null;
    taskId: string | null;
    createdAt: string;
}
export declare class CreditsRepository {
    private db;
    constructor(db: Database.Database);
    deduct(userId: string, amount: number, type: CreditTransaction['type'], description?: string, taskId?: string): CreditTransaction;
    add(userId: string, amount: number, type: CreditTransaction['type'], description?: string): CreditTransaction;
    getBalance(userId: string): number;
    getHistory(userId: string, limit?: number, offset?: number): CreditTransaction[];
    private mapRow;
}
//# sourceMappingURL=credits.d.ts.map