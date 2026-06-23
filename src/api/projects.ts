import { Router } from 'express';
import type Database from 'better-sqlite3';
import { ProjectsRepository } from '../db/repositories/projects.js';
import { SessionsRepository } from '../db/repositories/sessions.js';
import { ProjectRouter } from '../services/project-router.js';
import { UsersRepository } from '../db/repositories/users.js';
import { config } from '../config.js';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createLogger } from '../services/logger.js';

const log = createLogger('ProjectsAPI');

export function createProjectsRouter(db: Database.Database, projectRouter: ProjectRouter) {
  const router = Router();
  const projectsRepo = new ProjectsRepository(db);
  const usersRepo = new UsersRepository(db);
  const sessionsRepo = new SessionsRepository(db);

  router.get('/', (req, res) => {
    const userId = req.user!.userId;
    const projects = projectsRepo.findByUserId(userId);
    res.json({ projects });
  });

  router.post('/', async (req, res) => {
    const userId = req.user!.userId;
    const { name, folderPath, type } = req.body;
    if (!name || !folderPath || !type) {
      res.status(400).json({ error: 'name, folderPath, and type are required' });
      return;
    }
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
    try {
      db.prepare('UPDATE sessions SET user_id = ?, project_id = ? WHERE id = ?').run(userId, null, session.id);
    } catch {}

    const workspaceDir = resolve(config.workspaceBaseDir, user.username);
    mkdirSync(workspaceDir, { recursive: true });
    const projectDir = resolve(workspaceDir, folderPath);
    mkdirSync(projectDir, { recursive: true });

    const project = projectsRepo.create(userId, name, folderPath, type, session.id, type === 'node' ? 'stopped' : 'active');

    try {
      db.prepare('UPDATE sessions SET project_id = ? WHERE id = ?').run(project.id, session.id);
    } catch {}

    if (project.type === 'node') {
      log.info('Node project created in stopped state', { projectId: project.id, uuid: project.uuid });
    } else {
      try {
        const fullFolderPath = resolve(workspaceDir, folderPath);
        await projectRouter.mountProject(project, fullFolderPath);
        log.info('Project published', { projectId: project.id, uuid: project.uuid, type });
      } catch (err: any) {
        projectsRepo.updateStatus(project.id, 'error');
        log.error('Failed to mount project', { projectId: project.id, error: err.message });
        res.status(500).json({ error: `Failed to publish project: ${err.message}` });
        return;
      }
    }

    res.status(201).json({ project });
  });

  router.get('/:id', (req, res) => {
    const userId = req.user!.userId;
    const project = projectsRepo.findById(req.params.id);
    if (!project || project.userId !== userId) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json({ project });
  });

  router.post('/:id/start', async (req, res) => {
    const userId = req.user!.userId;
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
      const fullFolderPath = resolve(config.workspaceBaseDir, pUser.username, project.folderPath);
      await projectRouter.startProject(project, fullFolderPath);
      projectsRepo.updateStatus(project.id, 'active');
      log.info('Node project started', { projectId: project.id, uuid: project.uuid });
      res.json({ success: true });
    } catch (err: any) {
      log.error('Failed to start project', { projectId: project.id, error: err.message });
      projectsRepo.updateStatus(project.id, 'error');
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/stop', (req, res) => {
    const userId = req.user!.userId;
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
    } catch (err: any) {
      log.error('Failed to stop project', { projectId: project.id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id', (req, res) => {
    const userId = req.user!.userId;
    const project = projectsRepo.findById(req.params.id);
    if (!project || project.userId !== userId) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    try {
      projectRouter.unmountProject(project);
    } catch (err: any) {
      log.warn('Failed to unmount project cleanly', { projectId: project.id, error: err.message });
    }

    if (project.sessionId) {
      try {
        sessionsRepo.delete(project.sessionId);
      } catch {}
    }

    projectsRepo.delete(project.id);
    log.info('Project deleted', { projectId: project.id, uuid: project.uuid });
    res.json({ success: true });
  });

  return router;
}
