import { Router } from 'express';
import { TasksRepository } from '../db/repositories/tasks.js';
import { SessionsRepository } from '../db/repositories/sessions.js';
import { config } from '../config.js';
export function createTasksRouter(db, taskManager) {
    const router = Router();
    const tasksRepo = new TasksRepository(db);
    const sessionsRepo = new SessionsRepository(db);
    router.get('/', (_req, res) => {
        res.json({ tasks: taskManager.getTasks() });
    });
    router.post('/', (req, res) => {
        const { sessionId, description, model, maxSteps } = req.body;
        if (!description) {
            res.status(400).json({ error: 'description is required' });
            return;
        }
        try {
            let effectiveSessionId = sessionId;
            if (!effectiveSessionId) {
                const sessions = sessionsRepo.list();
                if (sessions.length === 0) {
                    const session = sessionsRepo.create('Default Session', config.defaultModel);
                    effectiveSessionId = session.id;
                }
                else {
                    effectiveSessionId = sessions[0].id;
                }
            }
            else {
                const existing = sessionsRepo.findById(effectiveSessionId);
                if (!existing) {
                    const session = sessionsRepo.create('Default Session', config.defaultModel);
                    effectiveSessionId = session.id;
                }
            }
            const task = taskManager.createTask(effectiveSessionId, description, model ?? null, maxSteps);
            res.status(201).json({ task });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    router.get('/:id', (req, res) => {
        const task = taskManager.getTask(req.params.id);
        if (!task) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }
        res.json({ task });
    });
    router.patch('/:id', (req, res) => {
        const { status } = req.body;
        if (status === 'cancelled') {
            taskManager.cancelTask(req.params.id);
        }
        res.json({ success: true });
    });
    router.get('/:id/steps', (req, res) => {
        const rows = db.prepare('SELECT * FROM agent_steps WHERE task_id = ? ORDER BY step_number ASC').all(req.params.id);
        const steps = rows.map(row => ({
            id: row.id,
            taskId: row.task_id,
            stepNumber: row.step_number,
            toolName: row.tool_name,
            toolInput: row.tool_input,
            toolOutput: row.tool_output,
            reasoning: row.reasoning,
            durationMs: row.duration_ms,
            status: row.status,
            createdAt: row.created_at,
        }));
        res.json({ steps });
    });
    return router;
}
//# sourceMappingURL=tasks.js.map