import { Router } from 'express';
import type Database from 'better-sqlite3';
import { UsersRepository, toPublic } from '../db/repositories/users.js';
import { CreditsRepository } from '../db/repositories/credits.js';
import { ModelConfigRepository } from '../db/repositories/model-config.js';
import { resolveModels } from '../services/model-resolver.js';
import { ConfigRepository } from '../db/repositories/config.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('AdminAPI');

export function createAdminRouter(db: Database.Database, usersRepo: UsersRepository, creditsRepo: CreditsRepository) {
  const router = Router();
  const modelConfigRepo = new ModelConfigRepository(db);
  const configRepo = new ConfigRepository(db);

  router.get('/users', (_req, res) => {
    const users = usersRepo.list();
    res.json({ users: users.map(toPublic) });
  });

  router.post('/users/:id/credits', (req, res) => {
    const { id } = req.params;
    const { amount, description } = req.body;
    if (!amount || typeof amount !== 'number') {
      res.status(400).json({ error: 'amount is required and must be a number' });
      return;
    }
    try {
      const tx = creditsRepo.add(id, amount, 'purchase', description ?? 'Admin credit grant');
      const user = usersRepo.findById(id);
      res.json({ success: true, transaction: tx, user: user ? toPublic(user) : null });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch('/users/:id/role', (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    if (!role || (role !== 'admin' && role !== 'user')) {
      res.status(400).json({ error: 'role must be "admin" or "user"' });
      return;
    }
    try {
      usersRepo.updateRole(id, role);
      const user = usersRepo.findById(id);
      res.json({ success: true, user: user ? toPublic(user) : null });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/users/:id', (req, res) => {
    const { id } = req.params;
    if (id === req.user?.userId) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }
    try {
      usersRepo.delete(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/users/:id/credits/history', (req, res) => {
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const history = creditsRepo.getHistory(id, limit, offset);
    const balance = creditsRepo.getBalance(id);
    res.json({ history, balance });
  });

  router.get('/stats', (_req, res) => {
    const totalUsers = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
    const totalProjects = (db.prepare('SELECT COUNT(*) as count FROM projects').get() as any).count;
    const totalTasks = (db.prepare('SELECT COUNT(*) as count FROM tasks').get() as any).count;
    const totalCreditsUsed = (db.prepare("SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM credit_transactions WHERE amount < 0").get() as any).total;
    const totalCreditsGranted = (db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM credit_transactions WHERE amount > 0").get() as any).total;
    const activeProjects = (db.prepare("SELECT COUNT(*) as count FROM projects WHERE status = 'active'").get() as any).count;
    const runningTasks = (db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'running'").get() as any).count;
    const totalSteps = (db.prepare("SELECT COUNT(*) as count FROM agent_steps").get() as any).count;
    res.json({ totalUsers, totalProjects, totalTasks, totalCreditsUsed, totalCreditsGranted, activeProjects, runningTasks, totalSteps });
  });

  router.get('/models', async (_req, res) => {
    try {
      const appConfig = configRepo.getAll();
      const apiModels = await resolveModels(appConfig.apiBaseUrl);
      const configuredModels = modelConfigRepo.list();
      const configMap = new Map(configuredModels.map(mc => [mc.modelId, mc]));

      const models: Array<{
        id: string;
        name: string;
        contextLength?: number;
        enabled: boolean;
        costPerStep: number;
        displayName: string | null;
        configured: boolean;
        offline?: boolean;
      }> = apiModels.map(m => {
        const cfg = configMap.get(m.id);
        return {
          id: m.id,
          name: m.name || m.id,
          contextLength: m.contextLength,
          enabled: cfg ? cfg.enabled : true,
          costPerStep: cfg ? cfg.costPerStep : 1,
          displayName: cfg?.displayName || null,
          configured: !!cfg,
        };
      });

      for (const cfg of configuredModels) {
        if (!apiModels.find(m => m.id === cfg.modelId)) {
          models.push({
            id: cfg.modelId,
            name: cfg.displayName || cfg.modelId,
            contextLength: undefined,
            enabled: cfg.enabled,
            costPerStep: cfg.costPerStep,
            displayName: cfg.displayName,
            configured: true,
            offline: true,
          });
        }
      }

      res.json({ models });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/models/:modelId', (req, res) => {
    const { modelId } = req.params;
    const { enabled, costPerStep, displayName } = req.body;

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    if (costPerStep !== undefined && (typeof costPerStep !== 'number' || costPerStep < 0)) {
      res.status(400).json({ error: 'costPerStep must be a non-negative number' });
      return;
    }

    try {
      const result = modelConfigRepo.upsert(
        decodeURIComponent(modelId),
        enabled ?? true,
        costPerStep ?? 1,
        displayName ?? null
      );
      res.json({ success: true, modelConfig: result });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/models/:modelId', (req, res) => {
    const { modelId } = req.params;
    try {
      modelConfigRepo.deleteByModelId(decodeURIComponent(modelId));
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
