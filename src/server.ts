import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { config } from './config.js';
import { initDatabase } from './db/index.js';
import { ConfigRepository } from './db/repositories/config.js';
import { UsersRepository } from './db/repositories/users.js';
import { CreditsRepository } from './db/repositories/credits.js';
import { SessionsRepository } from './db/repositories/sessions.js';
import { createChatRouter } from './api/chat.js';
import { createModelsRouter } from './api/models.js';
import { createTasksRouter } from './api/tasks.js';
import { createFilesRouter } from './api/files.js';
import { createConfigRouter } from './api/config.js';
import { createSessionsRouter } from './api/sessions.js';
import { createAuthRouter } from './api/auth.js';
import { createAdminRouter } from './api/admin.js';
import { createProjectsRouter } from './api/projects.js';
import { ProjectRouter } from './services/project-router.js';
import { ProjectsRepository } from './db/repositories/projects.js';
import { CreditManager } from './services/credit-manager.js';
import { TaskManager } from './services/task-manager.js';
import { ApprovalManager } from './services/approval-manager.js';
import { FileWatcher } from './services/file-watcher.js';
import { setupWebSocket } from './websocket/index.js';
import { authMiddleware } from './middleware/auth.js';
import { adminMiddleware } from './middleware/admin.js';
import { createLogger } from './services/logger.js';

const log = createLogger('Server');

log.info('Starting Web Agent server...', { port: config.port, apiBaseUrl: config.apiBaseUrl, defaultModel: config.defaultModel });

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  log.debug(`${req.method} ${req.url}`);
  next();
});

const dbPath = resolve(config.dataDir, 'web-agent.db');
log.info('Initializing database', { dbPath });
const db = initDatabase(dbPath);

const configRepo = new ConfigRepository(db);
const usersRepo = new UsersRepository(db);
const creditsRepo = new CreditsRepository(db);
const sessionsRepo = new SessionsRepository(db);

let adminUser = usersRepo.findByUsername('admin');
if (!adminUser) {
  adminUser = usersRepo.create('admin', config.adminPassword, 'admin', 999999, 'admin@webagent.local');
  creditsRepo.add(adminUser.id, 999999, 'bonus', 'Admin initial credits');
  log.info('Admin user bootstrapped', { userId: adminUser.id });
} else {
  log.info('Admin user already exists');
}

const existingSessions = sessionsRepo.list();
if (existingSessions.length === 0) {
  const session = sessionsRepo.create('Default Session', config.defaultModel);
  try {
    db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run(adminUser.id, session.id);
  } catch {}
  log.info('Default session created for admin');
} else {
  db.prepare("UPDATE sessions SET model = ? WHERE model = 'meta/llama-3.1-405b-instruct'").run(config.defaultModel);
  try {
    db.prepare("UPDATE sessions SET user_id = ? WHERE user_id IS NULL OR user_id = '__migration__'").run(adminUser.id);
    db.prepare("UPDATE messages SET user_id = ? WHERE user_id IS NULL OR user_id = '__migration__'").run(adminUser.id);
    db.prepare("UPDATE tasks SET user_id = ? WHERE user_id IS NULL OR user_id = '__migration__'").run(adminUser.id);
    log.info('Migrated existing records to admin user');
  } catch (err: any) {
    log.warn('Migration of records to admin user failed', { error: err.message });
  }
}

const creditManager = new CreditManager(db, creditsRepo, usersRepo);
const projectRouter = new ProjectRouter(app);
const taskManager = new TaskManager(db, creditManager);
const approvalManager = new ApprovalManager();
const fileWatcher = new FileWatcher();

mkdirSync(config.workspaceBaseDir, { recursive: true });

const allUsers = usersRepo.list();
for (const u of allUsers) {
  const userDir = resolve(config.workspaceBaseDir, u.username);
  if (!existsSync(userDir)) {
    mkdirSync(userDir, { recursive: true });
    log.info('Created workspace for user', { username: u.username, dir: userDir });
  }
}

app.use('/api/auth', createAuthRouter(db));

app.use('/api/admin', authMiddleware, adminMiddleware, createAdminRouter(db, usersRepo, creditsRepo, projectRouter));

app.use('/api/chat', authMiddleware, createChatRouter(db, taskManager, creditManager));
app.use('/api/models', authMiddleware, createModelsRouter(db, configRepo));
app.use('/api/tasks', authMiddleware, createTasksRouter(db, taskManager));
app.use('/api/files', authMiddleware, createFilesRouter(configRepo));
app.use('/api/config', authMiddleware, createConfigRouter(configRepo));
app.use('/api/sessions', authMiddleware, createSessionsRouter(db));
app.use('/api/projects', authMiddleware, createProjectsRouter(db, projectRouter));

app.use('/p', projectRouter.middleware());

const publicDir = existsSync(join(process.cwd(), 'public'))
  ? join(process.cwd(), 'public')
  : join(process.cwd(), 'frontend', 'dist');
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('{*path}', (_req, res) => {
    res.sendFile(join(publicDir, 'index.html'));
  });
  log.info('Serving static files', { publicDir });
} else {
  log.warn('No static directory found for frontend');
}

setupWebSocket(io, approvalManager, taskManager, creditManager);
log.info('WebSocket setup complete');

fileWatcher.start(config.workspaceBaseDir, io);
log.info('File watcher started', { dir: config.workspaceBaseDir });

const projectsRepo = new ProjectsRepository(db);
const allProjects = projectsRepo.listAll();

(async () => {
  for (const p of allProjects) {
    try {
      const pUser = usersRepo.findById(p.userId);
      if (pUser && p.status === 'active') {
        const fullFolderPath = resolve(config.workspaceBaseDir, pUser.username, p.folderPath);
        await projectRouter.mountProject(p, fullFolderPath);
        log.info('Remounted project on startup', { uuid: p.uuid, name: p.name });
      }
    } catch (err: any) {
      log.warn('Failed to remount project on startup', { uuid: p.uuid, error: err.message });
      try {
        projectsRepo.updateStatus(p.id, 'error');
      } catch {}
    }
  }
})();

httpServer.listen(config.port, () => {
  log.info(`Web Agent running on http://localhost:${config.port}`);
  log.info('Available routes: /api/auth, /api/admin, /api/chat, /api/models, /api/tasks, /api/files, /api/config, /api/sessions, /api/projects');
});

process.on('SIGINT', () => {
  log.info('Shutting down (SIGINT)...');
  fileWatcher.stop();
  projectRouter.shutdownAll();
  db.close();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', { reason: String(reason) });
});
