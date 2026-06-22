import { Router } from 'express';
import type Database from 'better-sqlite3';
import { ProjectsRepository } from '../db/repositories/projects.js';
import { ProjectRouter } from '../services/project-router.js';
import { UsersRepository } from '../db/repositories/users.js';
import { config } from '../config.js';
import { resolve } from 'node:path';
import { createLogger } from '../services/logger.js';

const log = createLogger('ProjectsAPI');

export function createProjectsRouter(db: Database.Database, projectRouter: ProjectRouter) {
  const router = Router();
  const projectsRepo = new ProjectsRepository(db);
  const usersRepo = new UsersRepository(db);

  router.get('/', (req, res) => {
    const userId = req.user!.userId;
    const projects = projectsRepo.findByUserId(userId);
    res.json({ projects });
  });

  router.post('/', (req, res) => {
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

    const project = projectsRepo.create(userId, name, folderPath, type);

    try {
      const workspaceDir = resolve(config.workspaceBaseDir, user.username);
      const fullFolderPath = resolve(workspaceDir, folderPath);

      projectRouter.mountProject(project, fullFolderPath);
      log.info('Project published', { projectId: project.id, uuid: project.uuid, type });
    } catch (err: any) {
      projectsRepo.updateStatus(project.id, 'error');
      log.error('Failed to mount project', { projectId: project.id, error: err.message });
      res.status(500).json({ error: `Failed to publish project: ${err.message}` });
      return;
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

    projectsRepo.delete(project.id);
    log.info('Project deleted', { projectId: project.id, uuid: project.uuid });
    res.json({ success: true });
  });

  return router;
}
