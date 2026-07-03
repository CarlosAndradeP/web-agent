import { Router } from 'express';
import { ProjectsRepository } from '../db/repositories/projects.js';
import { SessionsRepository } from '../db/repositories/sessions.js';
import { UsersRepository } from '../db/repositories/users.js';
import { config } from '../config.js';
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createLogger } from '../services/logger.js';
import { getUserWorkspaceDir, resolveUserWorkspacePath } from '../lib/workspace-paths.js';
const log = createLogger('ProjectsAPI');
export function createProjectsRouter(db, projectRouter) {
    const router = Router();
    const projectsRepo = new ProjectsRepository(db);
    const usersRepo = new UsersRepository(db);
    const sessionsRepo = new SessionsRepository(db);
    router.get('/', (req, res) => {
        const userId = req.user.userId;
        const projects = projectsRepo.findByUserId(userId);
        res.json({ projects });
    });
    router.post('/', async (req, res) => {
        const userId = req.user.userId;
        const { name, folderPath, type: reqType } = req.body;
        if (!name || !folderPath) {
            res.status(400).json({ error: 'name and folderPath are required' });
            return;
        }
        const type = reqType || 'static';
        if (!['static', 'php', 'node'].includes(type)) {
            res.status(400).json({ error: 'type must be "static", "php", or "node"' });
            return;
        }
        const user = usersRepo.findById(userId);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const session = sessionsRepo.create(name, config.defaultModel);
        // Stamp ownership and project_id together atomically. If either fails we
        // delete the unowned session rather than risk it being adopted by another
        // user later — sessions.user_id NULL is treated as admin/orphan in
        // ownership checks elsewhere.
        if (userId) {
            try {
                db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run(userId, session.id);
            }
            catch (err) {
                log.error('Failed to assign session owner', { sessionId: session.id, userId, error: err.message });
                sessionsRepo.delete(session.id);
                res.status(500).json({ error: 'Failed to create project session' });
                return;
            }
        }
        const workspaceDir = getUserWorkspaceDir(user.username);
        mkdirSync(workspaceDir, { recursive: true });
        let projectDir;
        try {
            projectDir = resolveUserWorkspacePath(user.username, folderPath);
        }
        catch (err) {
            sessionsRepo.delete(session.id);
            res.status(400).json({ error: err.message });
            return;
        }
        mkdirSync(projectDir, { recursive: true });
        const project = projectsRepo.create(userId, name, folderPath, type, session.id, type === 'node' ? 'stopped' : 'active');
        // Link the session back to the project. project_id is the internal project
        // id (not the uuid). If this fails we surface the error and roll back the
        // session + project so a half-linked cross-reference is never persisted.
        try {
            const tx = db.transaction(() => {
                db.prepare('UPDATE sessions SET project_id = ? WHERE id = ?').run(project.id, session.id);
            });
            tx();
        }
        catch (err) {
            log.error('Failed to set session.project_id, rolling back', { sessionId: session.id, projectId: project.id, error: err.message });
            try {
                projectsRepo.delete(project.id);
                sessionsRepo.delete(session.id);
            }
            catch (cleanupErr) {
                log.error('Rollback failed after project_id link failure', { error: cleanupErr.message });
            }
            res.status(500).json({ error: 'Failed to link project session' });
            return;
        }
        if (project.type === 'node') {
            log.info('Node project created in stopped state', { projectId: project.id, uuid: project.uuid });
        }
        else {
            try {
                await projectRouter.mountProject(project, projectDir);
                log.info('Project published', { projectId: project.id, uuid: project.uuid, type });
            }
            catch (err) {
                projectsRepo.updateStatus(project.id, 'error');
                log.error('Failed to mount project', { projectId: project.id, error: err.message });
                res.status(500).json({ error: `Failed to publish project: ${err.message}` });
                return;
            }
        }
        res.status(201).json({ project });
    });
    router.get('/:id', (req, res) => {
        const userId = req.user.userId;
        const project = projectsRepo.findById(req.params.id);
        if (!project || project.userId !== userId) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        res.json({ project });
    });
    router.post('/:id/start', async (req, res) => {
        const userId = req.user.userId;
        const project = projectsRepo.findById(req.params.id);
        if (!project || project.userId !== userId) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        if (project.type !== 'node') {
            res.status(400).json({ error: 'Only Node.js projects can be started' });
            return;
        }
        try {
            const pUser = usersRepo.findById(userId);
            if (!pUser) {
                res.status(404).json({ error: 'User not found' });
                return;
            }
            const fullFolderPath = resolveUserWorkspacePath(pUser.username, project.folderPath, { allowRoot: true });
            await projectRouter.startProject(project, fullFolderPath);
            projectsRepo.updateStatus(project.id, 'active');
            log.info('Node project started', { projectId: project.id, uuid: project.uuid });
            res.json({ success: true });
        }
        catch (err) {
            log.error('Failed to start project', { projectId: project.id, error: err.message });
            projectsRepo.updateStatus(project.id, 'error');
            res.status(500).json({ error: err.message });
        }
    });
    router.post('/:id/stop', (req, res) => {
        const userId = req.user.userId;
        const project = projectsRepo.findById(req.params.id);
        if (!project || project.userId !== userId) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        if (project.type !== 'node') {
            res.status(400).json({ error: 'Only Node.js projects can be stopped' });
            return;
        }
        try {
            projectRouter.stopProject(project.uuid);
            projectsRepo.updateStatus(project.id, 'stopped');
            log.info('Node project stopped', { projectId: project.id, uuid: project.uuid });
            res.json({ success: true });
        }
        catch (err) {
            log.error('Failed to stop project', { projectId: project.id, error: err.message });
            res.status(500).json({ error: err.message });
        }
    });
    router.post('/:id/promote-node', async (req, res) => {
        const userId = req.user.userId;
        const project = projectsRepo.findById(req.params.id);
        if (!project || project.userId !== userId) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        if (project.type === 'node') {
            res.json({ project, alreadyNode: true });
            return;
        }
        const pUser = usersRepo.findById(userId);
        if (!pUser) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const fullFolderPath = resolveUserWorkspacePath(pUser.username, project.folderPath, { allowRoot: true });
        const pkgJsonPath = resolve(fullFolderPath, 'package.json');
        if (!existsSync(pkgJsonPath)) {
            res.status(400).json({ error: 'No package.json found in project folder' });
            return;
        }
        try {
            projectRouter.unmountProject(project);
        }
        catch (err) {
            log.warn('Failed to unmount static/php project during promote', { projectId: project.id, error: err.message });
        }
        projectsRepo.updateType(project.id, 'node');
        projectsRepo.updateStatus(project.id, 'stopped');
        const updatedProject = projectsRepo.findById(project.id);
        try {
            await projectRouter.startProject(updatedProject, fullFolderPath);
            projectsRepo.updateStatus(project.id, 'active');
            log.info('Project promoted to Node.js', { projectId: project.id, uuid: project.uuid });
            res.json({ project: projectsRepo.findById(project.id) });
        }
        catch (err) {
            log.error('Failed to start promoted Node project', { projectId: project.id, error: err.message });
            projectsRepo.updateStatus(project.id, 'error');
            res.status(500).json({ error: `Failed to start Node.js project: ${err.message}` });
        }
    });
    router.delete('/:id', (req, res) => {
        const userId = req.user.userId;
        const project = projectsRepo.findById(req.params.id);
        if (!project || project.userId !== userId) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        try {
            projectRouter.unmountProject(project);
        }
        catch (err) {
            log.warn('Failed to unmount project cleanly', { projectId: project.id, error: err.message });
        }
        if (project.sessionId) {
            try {
                sessionsRepo.delete(project.sessionId);
            }
            catch (err) {
                // The project is still removed below; leave the orphaned session in
                // place rather than masking the project-delete error path.
                log.warn('Failed to delete linked session during project delete', { sessionId: project.sessionId, projectId: project.id, error: err.message });
            }
        }
        projectsRepo.delete(project.id);
        log.info('Project deleted', { projectId: project.id, uuid: project.uuid });
        res.json({ success: true });
    });
    return router;
}
//# sourceMappingURL=projects.js.map