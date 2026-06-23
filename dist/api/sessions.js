import { Router } from 'express';
import { SessionsRepository } from '../db/repositories/sessions.js';
import { MessagesRepository } from '../db/repositories/messages.js';
export function createSessionsRouter(db) {
    const router = Router();
    const sessionsRepo = new SessionsRepository(db);
    const messagesRepo = new MessagesRepository(db);
    router.get('/', (req, res) => {
        const userId = req.user?.userId;
        let sessions = sessionsRepo.list();
        if (userId) {
            sessions = sessions.filter(s => {
                const row = db.prepare('SELECT user_id FROM sessions WHERE id = ?').get(s.id);
                return row?.user_id === userId || !row?.user_id;
            });
        }
        res.json({ sessions });
    });
    router.post('/', (req, res) => {
        const { name, model } = req.body;
        const userId = req.user?.userId;
        if (!name) {
            res.status(400).json({ error: 'name is required' });
            return;
        }
        const session = sessionsRepo.create(name, model ?? 'z-ai/glm-5.1');
        if (userId) {
            try {
                db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run(userId, session.id);
            }
            catch { }
        }
        res.status(201).json({ session });
    });
    router.get('/:id/messages', (req, res) => {
        const messages = messagesRepo.findBySession(req.params.id);
        res.json({ messages });
    });
    router.delete('/:id', (req, res) => {
        sessionsRepo.delete(req.params.id);
        res.json({ success: true });
    });
    return router;
}
//# sourceMappingURL=sessions.js.map