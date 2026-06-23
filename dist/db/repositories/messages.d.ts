import type Database from 'better-sqlite3';
import type { Message } from '../../types/index.js';
export declare class MessagesRepository {
    private db;
    constructor(db: Database.Database);
    create(sessionId: string, role: string, content: string | null, toolCalls?: string | null, toolCallId?: string | null, stepNumber?: number | null): Message;
    findBySession(sessionId: string): Message[];
}
//# sourceMappingURL=messages.d.ts.map