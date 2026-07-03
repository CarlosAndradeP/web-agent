import { Router } from 'express';
import { SessionsRepository } from '../db/repositories/sessions.js';
import { MessagesRepository } from '../db/repositories/messages.js';
import { config } from '../config.js';
import { createLogger } from '../services/logger.js';
const log = createLogger('SessionsAPI');
export function createSessionsRouter(db) {
    const router = Router();
    const sessionsRepo = new SessionsRepository(db);
    const messagesRepo = new MessagesRepository(db);
    const isAdmin = (req) => req.user?.role === 'admin';
    // GET / — List sessions. Non-admins see only their own
    router.get('/', (req, res) => {
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const userId = req.user?.userId;
        if (isAdmin(req)) {
            const sessions = sessionsRepo.listPaginated(limit, offset);
            const total = sessionsRepo.count();
            res.json({ sessions, total, limit, offset });
        }
        else {
            const sessions = sessionsRepo.findByUserId(userId, limit, offset);
            const total = sessionsRepo.countByUserId(userId);
            res.json({ sessions, total, limit, offset });
        }
    });
    router.post('/', (req, res) => {
        const { name, model } = req.body;
        const userId = req.user?.userId;
        if (!name) {
            res.status(400).json({ error: 'name is required' });
            return;
        }
        const session = sessionsRepo.create(name, model ?? config.defaultModel);
        if (userId) {
            // Wrap in a transaction so a failure leaves both the INSERT and the
            // ownership UPDATE either fully applied or rolled back, instead of an
            // unowned row that any non-admin could later read/delete.
            const tx = db.transaction(() => {
                db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run(userId, session.id);
            });
            try {
                tx();
            }
            catch (err) {
                log.error('Failed to assign session owner — leaving session deleted', { sessionId: session.id, userId, error: err.message });
                sessionsRepo.delete(session.id);
                res.status(500).json({ error: 'Failed to create session' });
                return;
            }
        }
        res.status(201).json({ session });
    });
    // GET /:id/messages — Verify ownership for non-admins
    router.get('/:id/messages', (req, res) => {
        const session = sessionsRepo.findById(req.params.id);
        if (!session) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        if (!isAdmin(req) && session.userId && session.userId !== req.user?.userId) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const messages = messagesRepo.findBySession(req.params.id);
        res.json({ messages });
    });
    // DELETE /:id/messages — Clear all messages in a session
    router.delete('/:id/messages', (req, res) => {
        const session = sessionsRepo.findById(req.params.id);
        if (!session) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        if (!isAdmin(req) && session.userId && session.userId !== req.user?.userId) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const deleted = messagesRepo.deleteBySession(req.params.id);
        res.json({ success: true, deleted });
    });
    // DELETE /:id — Verify ownership for non-admins
    router.delete('/:id', (req, res) => {
        const session = sessionsRepo.findById(req.params.id);
        if (!session) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        if (!isAdmin(req) && session.userId && session.userId !== req.user?.userId) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        sessionsRepo.delete(req.params.id);
        res.json({ success: true });
    });
    return router;
}
//# sourceMappingURL=sessions.js.map