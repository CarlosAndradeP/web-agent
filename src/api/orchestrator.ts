import { Router } from 'express';
import multer from 'multer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { basename, posix } from 'node:path';
import { OrchestratorManager } from '../orchestrator/orchestrator-manager.js';
import { OrchestratorSessionsRepository, OrchestratorStepsRepository, OrchestratorStateRepository, OrchestratorTasksRepository } from '../db/repositories/orchestrator.js';
import { UsersRepository } from '../db/repositories/users.js';
import { createLogger } from '../services/logger.js';
import { safeWorkspacePath } from '../agent/tools/sanitize.js';
import { getUserWorkspaceDir, resolveUserWorkspacePath } from '../lib/workspace-paths.js';

const log = createLogger('API:Orchestrator');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function sanitizeFilename(originalname: string): string {
  const base = basename(originalname);
  const normalized = base.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const safeName = segments.filter(s => s && s !== '.' && s !== '..').join(posix.sep);
  if (!safeName) throw new Error('Invalid filename');
  return safeName;
}

export function createOrchestratorRouter(
  manager: OrchestratorManager,
  sessionsRepo: OrchestratorSessionsRepository,
  stepsRepo: OrchestratorStepsRepository,
  stateRepo: OrchestratorStateRepository,
  tasksRepo: OrchestratorTasksRepository,
) {
  const router = Router();

  const isAdminOrOwner = (req: any, session: any): boolean => {
    return req.user?.role === 'admin' || req.user?.userId === session.userId;
  };

  const getWorkspaceDir = (req: any, sessionId?: string | null): string | null => {
    const userId = req.user?.userId;
    if (!userId) return null;
    const db = (sessionsRepo as any).db;
    const usersRepo = new UsersRepository(db);
    const user = usersRepo.findById(userId);
    if (!user) return null;
    const baseDir = getUserWorkspaceDir(user.username);
    if (sessionId) {
      try {
        const projectRow = db.prepare(
          'SELECT p.folder_path, u.username FROM projects p JOIN users u ON u.id = p.user_id WHERE p.session_id = ?'
        ).get(sessionId) as any;
        if (projectRow && projectRow.folder_path) {
          const projectDir = resolveUserWorkspacePath(projectRow.username, projectRow.folder_path, { allowRoot: true });
          mkdirSync(projectDir, { recursive: true });
          log.info('Orchestrator using project workspace', { sessionId, folderPath: projectRow.folder_path, workspaceDir: projectDir });
          return projectDir;
        }
        const owner = db.prepare(
          'SELECT u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?'
        ).get(sessionId) as any;
        if (owner?.username) return getUserWorkspaceDir(owner.username);
      } catch (err: any) {
        log.warn('Failed to resolve project workspace for orchestrator', { sessionId, error: err.message });
      }
    }
    return baseDir;
  };

  router.post('/start', async (req, res) => {
    const user = req.user!;
    const { sessionId, objective, mdFiles } = req.body;

    if (typeof objective !== 'string' || !objective.trim()) {
      res.status(400).json({ error: 'Objective is required' });
      return;
    }

    if (objective.length > 20_000) {
      res.status(400).json({ error: 'Objective is too long' });
      return;
    }

    try {
      let validatedSessionId: string | null = null;
      if (sessionId !== undefined && sessionId !== null) {
        if (typeof sessionId !== 'string' || !sessionId) {
          res.status(400).json({ error: 'Invalid sessionId' });
          return;
        }
        const db = (sessionsRepo as any).db;
        const parentSession = db.prepare('SELECT id, user_id FROM sessions WHERE id = ?').get(sessionId) as any;
        if (!parentSession) {
          res.status(404).json({ error: 'Parent session not found' });
          return;
        }
        if (user.role !== 'admin' && parentSession.user_id !== user.userId) {
          res.status(403).json({ error: 'Not authorized for parent session' });
          return;
        }
        validatedSessionId = sessionId;
      }
      const existingActive = sessionsRepo.listByUserId(user.userId).find(existing =>
        (existing.sessionId ?? null) === validatedSessionId && (existing.status === 'running' || existing.status === 'paused')
      );
      if (existingActive) {
        res.status(409).json({ error: `An autonomous session is already ${existingActive.status} for this workspace` });
        return;
      }
      const workspaceDir = getWorkspaceDir(req, validatedSessionId);
      const session = sessionsRepo.create(validatedSessionId, user.userId, objective.trim(), workspaceDir);

      if (mdFiles && Array.isArray(mdFiles) && mdFiles.length > 0) {
        const validMdFiles = mdFiles.filter((path): path is string => typeof path === 'string' && /\.md$/i.test(path));
        sessionsRepo.updateMdFiles(session.id, JSON.stringify(validMdFiles));
        session.mdFiles = JSON.stringify(validMdFiles);
      }

      try {
        await manager.start(session.id);
      } catch (err) {
        sessionsRepo.delete(session.id);
        throw err;
      }

      res.json({ session: mapSession(sessionsRepo.findById(session.id) ?? session) });
    } catch (err: any) {
      log.error('Failed to start orchestrator', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/prepare-md', upload.array('files', 20), (req, res) => {
    const user = req.user!;
    const parentSessionId = typeof req.body.sessionId === 'string' && req.body.sessionId ? req.body.sessionId : null;
    const db = (sessionsRepo as any).db;

    if (parentSessionId) {
      const parentSession = db.prepare('SELECT id, user_id FROM sessions WHERE id = ?').get(parentSessionId) as any;
      if (!parentSession) {
        res.status(404).json({ error: 'Parent session not found' });
        return;
      }
      if (user.role !== 'admin' && parentSession.user_id !== user.userId) {
        res.status(403).json({ error: 'Not authorized for parent session' });
        return;
      }
    }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const mdFiles = files.filter(file => /\.md$/i.test(file.originalname));
    if (mdFiles.length === 0) {
      res.status(400).json({ error: 'At least one .md file is required' });
      return;
    }

    const workspaceDir = getWorkspaceDir(req, parentSessionId);
    if (!workspaceDir) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const relativeDir = '.orchestrator/specs';
      const specsDir = safeWorkspacePath(workspaceDir, relativeDir);
      mkdirSync(specsDir, { recursive: true });
      const batchId = Date.now();
      const uploaded = mdFiles.map((file, index) => {
        const safeName = sanitizeFilename(file.originalname);
        const relativePath = `${relativeDir}/${batchId}-${index}-${safeName}`;
        writeFileSync(safeWorkspacePath(workspaceDir, relativePath), file.buffer);
        return relativePath;
      });
      res.json({ uploaded });
    } catch (err: any) {
      log.error('Prepare .md upload failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:sessionId/stop', (req, res) => {
    const sessionId = req.params.sessionId as string;
    const session = sessionsRepo.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!isAdminOrOwner(req, session)) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    if (session.status !== 'running' && session.status !== 'paused') {
      res.status(409).json({ error: `Cannot stop a ${session.status} session` });
      return;
    }

    manager.stop(sessionId);
    res.json({ success: true });
  });

  router.post('/:sessionId/pause', (req, res) => {
    const sessionId = req.params.sessionId as string;
    const session = sessionsRepo.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!isAdminOrOwner(req, session)) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    if (session.status !== 'running') {
      res.status(409).json({ error: `Cannot pause a ${session.status} session` });
      return;
    }

    manager.pause(sessionId);
    res.json({ success: true });
  });

  router.post('/:sessionId/resume', async (req, res) => {
    const sessionId = req.params.sessionId as string;
    const session = sessionsRepo.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!isAdminOrOwner(req, session)) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    if (session.status !== 'paused') {
      res.status(409).json({ error: `Cannot resume a ${session.status} session` });
      return;
    }

    try {
      await manager.resume(sessionId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/status', (req, res) => {
    const state = stateRepo.get();
    const userId = req.user!.userId;
    const parentSessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : null;
    const userSessions = sessionsRepo.listByUserId(userId);
    const candidates = parentSessionId ? userSessions.filter(s => s.sessionId === parentSessionId) : userSessions;
    const selected = candidates.find(s => manager.isRunning(s.id)) ?? candidates[0] ?? null;
    const activeSessions = manager.getActiveSessions().filter(id => {
      const active = sessionsRepo.findById(id);
      return active?.userId === userId;
    });

    res.json({
      isRunning: selected ? manager.isRunning(selected.id) : false,
      lastHeartbeat: state.lastHeartbeat,
      currentSessionId: selected?.id ?? null,
      totalStepsCompleted: selected?.totalStepsUsed ?? 0,
      activeSessions,
      session: selected ? mapSession(selected) : null,
    });
  });

  router.get('/:sessionId/status', (req, res) => {
    const sessionId = req.params.sessionId as string;
    const session = sessionsRepo.findById(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!isAdminOrOwner(req, session)) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    res.json({
      session: mapSession(session),
      isRunning: manager.isRunning(sessionId),
    });
  });

  router.get('/:sessionId/steps', (req, res) => {
    const sessionId = req.params.sessionId as string;
    const session = sessionsRepo.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!isAdminOrOwner(req, session)) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

    const allSteps = stepsRepo.findBySession(sessionId);
    const total = allSteps.length;
    const steps = allSteps.slice(offset, offset + limit).map(mapStep);

    res.json({ steps, total, limit, offset });
  });

  router.get('/:sessionId/tasks', (req, res) => {
    const sessionId = req.params.sessionId as string;
    const session = sessionsRepo.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!isAdminOrOwner(req, session)) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    try {
      const tasks = tasksRepo.findBySession(sessionId).map(mapTask);
      res.json({ tasks, total: tasks.length });
    } catch (err: any) {
      log.error('Failed to list orchestrator tasks', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:sessionId/upload-md', upload.array('files', 20), async (req, res) => {
    const sessionId = req.params.sessionId as string;
    const session = sessionsRepo.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!isAdminOrOwner(req, session)) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    const workspaceDir = session.workspaceDir ?? getWorkspaceDir(req);
    if (!workspaceDir) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const mdFiles = files.filter(file => /\.md$/i.test(file.originalname));
    if (mdFiles.length === 0) {
      res.status(400).json({ error: 'At least one .md file is required' });
      return;
    }
    const uploaded: string[] = [];

    try {
      const relativeDir = '.orchestrator/specs';
      mkdirSync(safeWorkspacePath(workspaceDir, relativeDir), { recursive: true });
      const batchId = Date.now();
      for (const [index, file] of mdFiles.entries()) {
        const safeName = sanitizeFilename(file.originalname);
        const relativePath = `${relativeDir}/${batchId}-${index}-${safeName}`;
        const destPath = safeWorkspacePath(workspaceDir, relativePath);
        writeFileSync(destPath, file.buffer);
        uploaded.push(relativePath);
      }

      const existing = parseStringArray(session.mdFiles);
      const merged = [...new Set([...existing, ...uploaded])];
      sessionsRepo.updateMdFiles(sessionId, JSON.stringify(merged));

      res.json({ success: true, mdFiles: merged });
    } catch (err: any) {
      log.error('Upload .md failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

function mapSession(row: any): any {
  return {
    id: row.id,
    sessionId: row.sessionId ?? row.session_id,
    status: row.status,
    objective: row.objective,
    currentStep: row.currentStep ?? row.current_step,
    progressPercent: row.progressPercent ?? row.progress_percent,
    errorCount: row.errorCount ?? row.error_count,
    totalStepsUsed: row.totalStepsUsed ?? row.total_steps_used ?? 0,
    autoRecover: row.autoRecover ?? row.auto_recover,
    mdFiles: row.mdFiles ? parseStringArray(row.mdFiles) : null,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function mapStep(row: any): any {
  return {
    id: row.id,
    orchestratorSessionId: row.orchestratorSessionId ?? row.orchestrator_session_id,
    stepNumber: row.stepNumber ?? row.step_number,
    role: row.role,
    model: row.model,
    action: row.action,
    input: row.input,
    output: row.output,
    status: row.status,
    errorMessage: row.errorMessage ?? row.error_message,
    durationMs: row.durationMs ?? row.duration_ms,
    createdAt: row.createdAt ?? row.created_at,
    completedAt: row.completedAt ?? row.completed_at,
  };
}

function mapTask(row: any): any {
  return {
    id: row.id,
    orchestratorSessionId: row.orchestratorSessionId ?? row.orchestrator_session_id,
    name: row.name,
    description: row.description,
    status: row.status,
    role: row.role,
    dependsOn: row.dependsOn ?? row.depends_on,
    output: row.output,
    errorMessage: row.errorMessage ?? row.error_message,
    stepNumber: row.stepNumber ?? row.step_number,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}
