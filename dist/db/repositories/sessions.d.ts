import type Database from 'better-sqlite3';
import type { Session } from '../../types/index.js';
export declare class SessionsRepository {
    private db;
    constructor(db: Database.Database);
    create(name: string, model: string): Session;
    findById(id: string): Session | undefined;
    list(): Session[];
    findByUserId(userId: string, limit?: number, offset?: number): Session[];
    countByUserId(userId: string): number;
    listPaginated(limit?: number, offset?: number): Session[];
    count(): number;
    delete(id: string): void;
    updateSummary(sessionId: string, summaryText: string): void;
    getSummary(sessionId: string): string | null;
}
//# sourceMappingURL=sessions.d.ts.map