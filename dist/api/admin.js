import { Router } from 'express';
import { resolve } from 'node:path';
import { toPublic } from '../db/repositories/users.js';
import { ModelConfigRepository } from '../db/repositories/model-config.js';
import { ProjectsRepository } from '../db/repositories/projects.js';
import { resolveModels } from '../services/model-resolver.js';
import { ConfigRepository } from '../db/repositories/config.js';
import { createLogger } from '../services/logger.js';
const log = createLogger('AdminAPI');
export function createAdminRouter(db, usersRepo, creditsRepo, projectRouter) {
    const router = Router();
    const modelConfigRepo = new ModelConfigRepository(db);
    const configRepo = new ConfigRepository(db);
    const projectsRepo = new ProjectsRepository(db);
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
        }
        catch (err) {
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
        }
        catch (err) {
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
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    router.get('/users/:id/credits/history', (req, res) => {
        const { id } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const history = creditsRepo.getHistory(id, limit, offset);
        const balance = creditsRepo.getBalance(id);
        res.json({ history, balance });
    });
    router.get('/stats', (_req, res) => {
        const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        const totalProjects = db.prepare('SELECT COUNT(*) as count FROM projects').get().count;
        const totalTasks = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
        const totalCreditsUsed = db.prepare("SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM credit_transactions WHERE amount < 0").get().total;
        const totalCreditsGranted = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM credit_transactions WHERE amount > 0").get().total;
        const activeProjects = db.prepare("SELECT COUNT(*) as count FROM projects WHERE status = 'active'").get().count;
        const runningTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'running'").get().count;
        const totalSteps = db.prepare("SELECT COUNT(*) as count FROM agent_steps").get().count;
        res.json({ totalUsers, totalProjects, totalTasks, totalCreditsUsed, totalCreditsGranted, activeProjects, runningTasks, totalSteps });
    });
    router.get('/models', async (_req, res) => {
        try {
            const appConfig = configRepo.getAll();
            const apiModels = await resolveModels(appConfig.apiBaseUrl);
            const configuredModels = modelConfigRepo.list();
            const configMap = new Map(configuredModels.map(mc => [mc.modelId, mc]));
            const models = apiModels.map(m => {
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
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // PUT /models — modelId in body (avoids Express 5 decoding %2F in URL paths)
    router.put('/models', (req, res) => {
        const { modelId, enabled, costPerStep, displayName } = req.body;
        if (!modelId || typeof modelId !== 'string') {
            res.status(400).json({ error: 'modelId is required and must be a string' });
            return;
        }
        if (enabled !== undefined && typeof enabled !== 'boolean') {
            res.status(400).json({ error: 'enabled must be a boolean' });
            return;
        }
        if (costPerStep !== undefined && (typeof costPerStep !== 'number' || costPerStep < 0)) {
            res.status(400).json({ error: 'costPerStep must be a non-negative number' });
            return;
        }
        try {
            const result = modelConfigRepo.upsert(modelId, enabled ?? true, costPerStep ?? 1, displayName ?? null);
            res.json({ success: true, modelConfig: result });
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    // POST /models/delete — modelId in body (avoids Express 5 decoding %2F in URL paths)
    router.post('/models/delete', (req, res) => {
        const { modelId } = req.body;
        if (!modelId || typeof modelId !== 'string') {
            res.status(400).json({ error: 'modelId is required and must be a string' });
            return;
        }
        try {
            modelConfigRepo.deleteByModelId(modelId);
            res.json({ success: true });
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    router.patch('/models/batch', (req, res) => {
        const { modelIds, enabled } = req.body;
        if (!Array.isArray(modelIds) || modelIds.length === 0) {
            res.status(400).json({ error: 'modelIds must be a non-empty array' });
            return;
        }
        if (typeof enabled !== 'boolean') {
            res.status(400).json({ error: 'enabled must be a boolean' });
            return;
        }
        try {
            const count = modelConfigRepo.batchSetEnabled(modelIds, enabled);
            res.json({ success: true, updated: count });
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    router.patch('/users/:id', (req, res) => {
        const { id } = req.params;
        const { email } = req.body;
        if (email !== undefined && typeof email !== 'string') {
            res.status(400).json({ error: 'email must be a string' });
            return;
        }
        try {
            usersRepo.updateEmail(id, email || null);
            const user = usersRepo.findById(id);
            res.json({ success: true, user: user ? toPublic(user) : null });
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    router.post('/users/:id/reset-password', (req, res) => {
        const { id } = req.params;
        const { newPassword } = req.body;
        if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 4) {
            res.status(400).json({ error: 'newPassword is required and must be at least 4 characters' });
            return;
        }
        try {
            usersRepo.updatePassword(id, newPassword);
            res.json({ success: true });
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    router.get('/settings', (_req, res) => {
        const registrationEnabled = configRepo.get('registration_enabled') !== 'false';
        res.json({ registrationEnabled });
    });
    router.patch('/settings', (req, res) => {
        const { registrationEnabled } = req.body;
        if (registrationEnabled !== undefined && typeof registrationEnabled !== 'boolean') {
            res.status(400).json({ error: 'registrationEnabled must be a boolean' });
            return;
        }
        if (registrationEnabled !== undefined) {
            configRepo.set('registration_enabled', String(registrationEnabled));
            log.info('Registration toggle updated', { registrationEnabled });
        }
        const current = configRepo.get('registration_enabled') !== 'false';
        res.json({ registrationEnabled: current });
    });
    router.get('/node-processes', (_req, res) => {
        try {
            const processes = projectRouter.getActiveNodeProjects();
            const enriched = processes.map(p => {
                const project = projectsRepo.findByUuid(p.uuid);
                const user = project ? usersRepo.findById(project.userId) : null;
                return { ...p, username: user?.username };
            });
            res.json({ processes: enriched });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    router.post('/node-processes/:uuid/stop', async (req, res) => {
        const { uuid } = req.params;
        try {
            projectRouter.stopProject(uuid);
            const project = projectsRepo.findByUuid(uuid);
            if (project)
                projectsRepo.updateStatus(project.id, 'stopped');
            res.json({ success: true });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    router.post('/node-processes/:uuid/restart', async (req, res) => {
        const { uuid } = req.params;
        try {
            projectRouter.stopProject(uuid);
            const project = projectsRepo.findByUuid(uuid);
            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }
            const user = usersRepo.findById(project.userId);
            if (!user) {
                res.status(404).json({ error: 'User not found' });
                return;
            }
            const fullFolderPath = resolve(process.env.WORKSPACE_BASE_DIR || './workspace', user.username, project.folderPath);
            await projectRouter.startProject(project, fullFolderPath);
            projectsRepo.updateStatus(project.id, 'active');
            res.json({ success: true });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=admin.js.map