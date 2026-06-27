import { Router } from 'express';
import type { TaskManager } from '../services/task-manager.js';
import type Database from 'better-sqlite3';
import { TasksRepository } from '../db/repositories/tasks.js';
import { SessionsRepository } from '../db/repositories/sessions.js';
import { config } from '../config.js';

export function createTasksRouter(db: Database.Database, taskManager: TaskManager) {
  const router = Router();
  const tasksRepo = new TasksRepository(db);
  const sessionsRepo = new SessionsRepository(db);

  const isAdmin = (req: any) => req.user?.role === 'admin';

  // GET / — List tasks. Non-admins see only their own tasks
  router.get('/', (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    if (isAdmin(req)) {
      const tasks = tasksRepo.listPaginated(limit, offset);
      const total = tasksRepo.count();
      res.json({ tasks, total, limit, offset });
    } else {
      const userId = req.user?.userId as string;
      const tasks = tasksRepo.findByUserId(userId, limit, offset);
      const total = tasksRepo.countByUserId(userId);
      res.json({ tasks, total, limit, offset });
    }
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
        } else {
          effectiveSessionId = sessions[0].id;
        }
      } else {
        const existing = sessionsRepo.findById(effectiveSessionId);
        if (!existing) {
          const session = sessionsRepo.create('Default Session', config.defaultModel);
          effectiveSessionId = session.id;
        }
      }
      const task = taskManager.createTask(effectiveSessionId, description, model ?? null, maxSteps);
      res.status(201).json({ task });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /:id — Check ownership for non-admins
  router.get('/:id', (req, res) => {
    const task = taskManager.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (!isAdmin(req) && task.userId && task.userId !== req.user?.userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    res.json({ task });
  });

  // PATCH /:id — Check ownership for non-admins
  router.patch('/:id', (req, res) => {
    const task = taskManager.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (!isAdmin(req) && task.userId && task.userId !== req.user?.userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const { status } = req.body;
    if (status === 'cancelled') {
      taskManager.cancelTask(req.params.id);
    }
    res.json({ success: true });
  });

  // GET /:id/steps — Check ownership for non-admins
  router.get('/:id/steps', (req, res) => {
    const task = taskManager.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (!isAdmin(req) && task.userId && task.userId !== req.user?.userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const rows = db.prepare('SELECT * FROM agent_steps WHERE task_id = ? ORDER BY step_number ASC').all(req.params.id) as any[];
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
