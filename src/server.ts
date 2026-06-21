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

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json());

const dbPath = resolve(config.dataDir, 'web-agent.db');
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
}

setupWebSocket(io, approvalManager, taskManager);
fileWatcher.start(config.workspaceDir, io);

httpServer.listen(config.port, () => {
  console.log(`Web Agent running on http://localhost:${config.port}`);
});

process.on('SIGINT', () => {
  fileWatcher.stop();
  db.close();
  process.exit(0);
});
