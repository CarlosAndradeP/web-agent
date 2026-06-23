import type Database from 'better-sqlite3';
import type { Session } from '../../types/index.js';
export declare class SessionsRepository {
    private db;
    constructor(db: Database.Database);
    create(name: string, model: string): Session;
    findById(id: string): Session | undefined;
    list(): Session[];
    delete(id: string): void;
}
//# sourceMappingURL=sessions.d.ts.map