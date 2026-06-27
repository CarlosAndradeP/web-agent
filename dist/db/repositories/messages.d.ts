import type Database from 'better-sqlite3';
import type { Message } from '../../types/index.js';
export declare class MessagesRepository {
    private db;
    constructor(db: Database.Database);
    create(sessionId: string, role: string, content: string | null, toolCalls?: string | null, toolCallId?: string | null, stepNumber?: number | null): Message;
    findBySession(sessionId: string, includeCompacted?: boolean): Message[];
    deleteBySession(sessionId: string): number;
    /**
     * Compact a session: insert a summary message and mark all prior messages as compacted.
     * Returns the ID of the created summary message.
     */
    compactSession(sessionId: string, summaryText: string): string;
    /**
     * Count non-compacted messages for a session.
     */
    countActive(sessionId: string): number;
    /**
     * Estimate total character count of active (non-compacted) messages for a session.
     */
    totalContentLength(sessionId: string): number;
}
//# sourceMappingURL=messages.d.ts.map