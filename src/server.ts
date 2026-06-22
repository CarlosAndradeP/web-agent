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
import { createChatRouter } from './api/chat.js';
import { createModelsRouter } from './api/models.js';
import { createTasksRouter } from './api/tasks.js';
import { createFilesRouter } from './api/files.js';
import { createConfigRouter } from './api/config.js';
import { createSessionsRouter } from './api/sessions.js';
import { TaskManager } from './services/task-manager.js';
import { ApprovalManager } from './services/approval-manager.js';
import { FileWatcher } from './services/file-watcher.js';
import { setupWebSocket } from './websocket/index.js';
import { SessionsRepository } from './db/repositories/sessions.js';
import { createLogger } from './services/logger.js';

const log = createLogger('Server');

log.info('Starting Web Agent server...', { port: config.port, apiBaseUrl: config.apiBaseUrl, defaultModel: config.defaultModel, agentType: config.agentType, workspaceDir: config.workspaceDir });

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
const taskManager = new TaskManager(db);
const approvalManager = new ApprovalManager();
const fileWatcher = new FileWatcher();

mkdirSync(config.workspaceDir, { recursive: true });

const sessionsRepo = new SessionsRepository(db);
const existing = sessionsRepo.list();
if (existing.length === 0) {
  sessionsRepo.create('Default Session', config.defaultModel);
  log.info('Default session created');
} else {
  db.prepare("UPDATE sessions SET model = ? WHERE model = 'meta/llama-3.1-405b-instruct'").run(config.defaultModel);
}

app.use('/api/chat', createChatRouter(db, taskManager));
app.use('/api/models', createModelsRouter(configRepo));
app.use('/api/tasks', createTasksRouter(db, taskManager));
app.use('/api/files', createFilesRouter(configRepo));
app.use('/api/config', createConfigRouter(configRepo));
app.use('/api/sessions', createSessionsRouter(db));

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
  log.warn('No static directory found for frontend', { checkedPaths: [join(process.cwd(), 'public'), join(process.cwd(), 'frontend', 'dist')] });
}

setupWebSocket(io, approvalManager, taskManager);
log.info('WebSocket setup complete');

fileWatcher.start(config.workspaceDir, io);
log.info('File watcher started', { dir: config.workspaceDir });

httpServer.listen(config.port, () => {
  log.info(`Web Agent running on http://localhost:${config.port}`);
  log.info('Available routes: /api/chat, /api/models, /api/tasks, /api/files, /api/config, /api/sessions');
});

process.on('SIGINT', () => {
  log.info('Shutting down (SIGINT)...');
  fileWatcher.stop();
  db.close();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', { reason: String(reason) });
});
