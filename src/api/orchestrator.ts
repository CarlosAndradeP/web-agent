import { Router } from 'express';
import multer from 'multer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename, join, posix } from 'node:path';
import { OrchestratorManager } from '../orchestrator/orchestrator-manager.js';
import { OrchestratorSessionsRepository, OrchestratorStepsRepository, OrchestratorStateRepository } from '../db/repositories/orchestrator.js';
import { UsersRepository } from '../db/repositories/users.js';
import { config } from '../config.js';
import { createLogger } from '../services/logger.js';

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
    const baseDir = resolve(config.workspaceBaseDir, user.username);
    if (sessionId) {
      try {
        const projectRow = db.prepare('SELECT folder_path FROM projects WHERE session_id = ?').get(sessionId) as any;
        if (projectRow && projectRow.folder_path) {
          const projectDir = resolve(baseDir, projectRow.folder_path);
          mkdirSync(projectDir, { recursive: true });
          log.info('Orchestrator using project workspace', { sessionId, folderPath: projectRow.folder_path, workspaceDir: projectDir });
          return projectDir;
        }
      } catch (err: any) {
        log.warn('Failed to resolve project workspace for orchestrator', { sessionId, error: err.message });
      }
    }
    return baseDir;
  };

  const validateSessionId = (req: any, sessionId?: string): string | null => {
    if (!sessionId) return null;
    const db = (sessionsRepo as any).db;
    const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    return row ? sessionId : null;
  };

  router.post('/start', async (req, res) => {
    const user = req.user!;
    const { sessionId, objective, mdFiles } = req.body;

    if (!objective) {
      res.status(400).json({ error: 'Objective is required' });
      return;
    }

    try {
      const validatedSessionId = validateSessionId(req, sessionId);
      const workspaceDir = getWorkspaceDir(req, validatedSessionId);
      const session = sessionsRepo.create(validatedSessionId, user.userId, objective, workspaceDir);

      if (mdFiles && Array.isArray(mdFiles) && mdFiles.length > 0) {
        sessionsRepo.updateMdFiles(session.id, JSON.stringify(mdFiles));
        session.mdFiles = JSON.stringify(mdFiles);
      }

      await manager.start(session.id);

      res.json({ session: mapSession(session) });
    } catch (err: any) {
      log.error('Failed to start orchestrator', { error: err.message });
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

    try {
      await manager.resume(sessionId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/status', (_req, res) => {
    const state = stateRepo.get();
    let session = null;

    if (state.currentSessionId) {
      const s = sessionsRepo.findById(state.currentSessionId);
      if (s) session = mapSession(s);
    }

    res.json({
      isRunning: state.isRunning,
      lastHeartbeat: state.lastHeartbeat,
      currentSessionId: state.currentSessionId,
      totalStepsCompleted: state.totalStepsCompleted,
      activeSessions: manager.getActiveSessions(),
      session,
    });
  });

  router.get('/:sessionId/status', (req, res) => {
    const sessionId = req.params.sessionId as string;
    const session = sessionsRepo.findById(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({
      session: mapSession(session),
      isRunning: manager.isRunning(sessionId),
    });
  });

  router.get('/:sessionId/steps', (req, res) => {
    const sessionId = req.params.sessionId as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const allSteps = stepsRepo.findBySession(sessionId);
    const total = allSteps.length;
    const steps = allSteps.slice(offset, offset + limit).map(mapStep);

    res.json({ steps, total, limit, offset });
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

    const files = req.files as Express.Multer.File[];
    const uploaded: string[] = [];

    try {
      for (const file of files) {
        if (!file.originalname.endsWith('.md')) continue;
        const safeName = sanitizeFilename(file.originalname);
        const destPath = join(workspaceDir, safeName);
        const resolvedDest = resolve(destPath);
        if (!resolvedDest.startsWith(resolve(workspaceDir))) {
          log.warn('Path traversal blocked in upload-md', { originalname: file.originalname });
          continue;
        }
        writeFileSync(destPath, file.buffer);
        uploaded.push(safeName);
      }

      const existing = session.mdFiles ? JSON.parse(session.mdFiles) : [];
      const merged = [...existing, ...uploaded];
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
    autoRecover: row.autoRecover ?? row.auto_recover,
    mdFiles: row.mdFiles ? JSON.parse(row.mdFiles) : null,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
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
