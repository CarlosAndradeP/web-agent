import { Router } from 'express';
import type Database from 'better-sqlite3';
import { UsersRepository, toPublic } from '../db/repositories/users.js';
import { CreditsRepository } from '../db/repositories/credits.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('AdminAPI');

export function createAdminRouter(db: Database.Database, usersRepo: UsersRepository, creditsRepo: CreditsRepository) {
  const router = Router();

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
    res.json({ totalUsers, totalProjects, totalTasks, totalCreditsUsed, totalCreditsGranted });
  });

  return router;
}
