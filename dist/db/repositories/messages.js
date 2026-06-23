import { v4 as uuid } from 'uuid';
export class MessagesRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    create(sessionId, role, content, toolCalls = null, toolCallId = null, stepNumber = null) {
        const id = uuid();
        const now = new Date().toISOString();
        this.db.prepare('INSERT INTO messages (id, session_id, role, content, tool_calls, tool_call_id, step_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, sessionId, role, content, toolCalls, toolCallId, stepNumber, now);
        return { id, sessionId, role: role, content, toolCalls, toolCallId, stepNumber, createdAt: now };
    }
    findBySession(sessionId) {
        const rows = this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId);
        return rows.map(row => ({
            id: row.id,
            sessionId: row.session_id,
            role: row.role,
            content: row.content,
            toolCalls: row.tool_calls,
            toolCallId: row.tool_call_id,
            stepNumber: row.step_number,
            createdAt: row.created_at,
        }));
    }
}
//# sourceMappingURL=messages.js.map