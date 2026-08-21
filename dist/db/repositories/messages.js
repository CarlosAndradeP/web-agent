import { v4 as uuid } from 'uuid';
export class MessagesRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    create(sessionId, role, content, toolCalls = null, toolCallId = null, stepNumber = null, modelContext = null) {
        const id = uuid();
        const now = new Date().toISOString();
        this.db.prepare('INSERT INTO messages (id, session_id, role, content, tool_calls, tool_call_id, step_number, model_context, is_compacted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)').run(id, sessionId, role, content, toolCalls, toolCallId, stepNumber, modelContext, now);
        return { id, sessionId, role: role, content, toolCalls, toolCallId, stepNumber, createdAt: now };
    }
    findBySession(sessionId, includeCompacted = false) {
        const query = includeCompacted
            ? 'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC'
            : 'SELECT * FROM messages WHERE session_id = ? AND (is_compacted IS NULL OR is_compacted = 0) ORDER BY created_at ASC';
        const rows = this.db.prepare(query).all(sessionId);
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
    /** Internal model transcript. model_context is intentionally not returned by findBySession(). */
    findForModelContext(sessionId, includeCompacted = false) {
        const query = includeCompacted
            ? 'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC'
            : 'SELECT * FROM messages WHERE session_id = ? AND (is_compacted IS NULL OR is_compacted = 0) ORDER BY created_at ASC';
        const rows = this.db.prepare(query).all(sessionId);
        return rows.map(row => ({
            id: row.id,
            sessionId: row.session_id,
            role: row.role,
            content: row.content,
            toolCalls: row.tool_calls,
            toolCallId: row.tool_call_id,
            stepNumber: row.step_number,
            createdAt: row.created_at,
            modelContext: row.model_context ?? null,
        }));
    }
    deleteBySession(sessionId) {
        const result = this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
        return result.changes;
    }
    /**
     * Compact a session: insert a summary message and mark all prior messages as compacted.
     * Returns the ID of the created summary message.
     */
    compactSession(sessionId, summaryText) {
        const id = uuid();
        const now = new Date().toISOString();
        const insertSummary = this.db.prepare('INSERT INTO messages (id, session_id, role, content, tool_calls, tool_call_id, step_number, is_compacted, created_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 1, ?)');
        const markCompacted = this.db.prepare('UPDATE messages SET is_compacted = 1 WHERE session_id = ? AND id != ? AND (is_compacted IS NULL OR is_compacted = 0)');
        const transaction = this.db.transaction(() => {
            insertSummary.run(id, sessionId, 'system', summaryText, now);
            markCompacted.run(sessionId, id);
        });
        transaction();
        return id;
    }
    /**
     * Count non-compacted messages for a session.
     */
    countActive(sessionId) {
        const row = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND (is_compacted IS NULL OR is_compacted = 0)').get(sessionId);
        return row?.count ?? 0;
    }
    /**
     * Estimate total character count of active (non-compacted) messages for a session.
     */
    totalContentLength(sessionId) {
        const row = this.db.prepare("SELECT COALESCE(SUM(LENGTH(COALESCE(content, '')) + LENGTH(COALESCE(tool_calls, '')) + LENGTH(COALESCE(model_context, ''))), 0) as total FROM messages WHERE session_id = ? AND (is_compacted IS NULL OR is_compacted = 0)").get(sessionId);
        return row?.total ?? 0;
    }
}
//# sourceMappingURL=messages.js.map