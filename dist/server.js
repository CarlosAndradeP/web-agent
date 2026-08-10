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
import { OrchestratorSessionsRepository, OrchestratorStepsRepository, OrchestratorStateRepository, OrchestratorTasksRepository } from './db/repositories/orchestrator.js';
import { createChatRouter } from './api/chat.js';
import { createModelsRouter } from './api/models.js';
import { createTasksRouter } from './api/tasks.js';
import { createFilesRouter } from './api/files.js';
import { createConfigRouter } from './api/config.js';
import { createSessionsRouter } from './api/sessions.js';
import { createAuthRouter } from './api/auth.js';
import { createAdminRouter } from './api/admin.js';
import { createProjectsRouter } from './api/projects.js';
import { createOrchestratorRouter } from './api/orchestrator.js';
import { createPaymentsRouter } from './api/payments.js';
import { ProjectRouter } from './services/project-router.js';
import { ProjectsRepository } from './db/repositories/projects.js';
import { CreditManager } from './services/credit-manager.js';
import { TaskManager } from './services/task-manager.js';
import { ApprovalManager } from './services/approval-manager.js';
import { CompactionService } from './services/compaction-service.js';
import { DailyCreditBonus } from './services/daily-credit-bonus.js';
import { FileWatcher } from './services/file-watcher.js';
import { OrchestratorManager } from './orchestrator/orchestrator-manager.js';
import { OrchestratorHeartbeat } from './orchestrator/heartbeat.js';
import { setupWebSocket } from './websocket/index.js';
import { authMiddleware } from './middleware/auth.js';
import { adminMiddleware } from './middleware/admin.js';
import { createLogger } from './services/logger.js';
import { resolveUserWorkspacePath } from './lib/workspace-paths.js';
const log = createLogger('Server');
const isProduction = process.env.NODE_ENV === 'production';
function getAllowedOrigins() {
    const origins = new Set();
    for (const origin of config.corsOrigins.split(',').map(o => o.trim()).filter(Boolean)) {
        origins.add(origin);
    }
    if (config.publicBaseUrl) {
        try {
            origins.add(new URL(config.publicBaseUrl).origin);
        }
        catch { }
    }
    if (!isProduction) {
        origins.add('http://localhost:5173');
        origins.add('http://127.0.0.1:5173');
        origins.add(`http://localhost:${config.port}`);
        origins.add(`http://127.0.0.1:${config.port}`);
    }
    return origins.size > 0 ? [...origins] : true;
}
const allowedOrigins = getAllowedOrigins();
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins === true || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error('CORS origin denied'));
    },
};
// Simple in-memory rate limiter. The cleanup interval is captured so it can be
// unref'd (so it doesn't keep the event loop alive) and the Map is capped to
// avoid unbounded growth under a flood of distinct IPs within a tick window.
function createRateLimiter(windowMs, maxRequests) {
    const hits = new Map();
    const MAX_KEYS = 10000;
    const cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) {
            if (now > entry.resetAt)
                hits.delete(key);
        }
    }, 60000);
    cleanupTimer.unref?.();
    return (req, res, next) => {
        // Combine req.ip (respects trust proxy if configured) with the socket's
        // remote address to avoid sharing one bucket when req.ip is undefined.
        const ip = req.ip ?? req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? 'unknown';
        const now = Date.now();
        if (hits.size >= MAX_KEYS) {
            // Drop the oldest ~10% to bound memory under flood.
            const dropCount = Math.ceil(MAX_KEYS / 10);
            let dropped = 0;
            for (const [key, entry] of hits) {
                if (dropped >= dropCount)
                    break;
                if (now > entry.resetAt) {
                    hits.delete(key);
                    dropped++;
                }
            }
            if (hits.size >= MAX_KEYS)
                hits.clear();
        }
        let entry = hits.get(ip);
        if (!entry || now > entry.resetAt) {
            entry = { count: 0, resetAt: now + windowMs };
            hits.set(ip, entry);
        }
        entry.count++;
        if (entry.count > maxRequests) {
            res.status(429).json({ error: 'Too many requests, please try again later' });
            return;
        }
        next();
    };
}
const authLimiter = createRateLimiter(60_000, 5); // 5 req/min per IP
const refreshLimiter = createRateLimiter(60_000, 20); // 20 req/min per IP
log.info('Starting Web Agent server...', { port: config.port, apiBaseUrl: config.apiBaseUrl, defaultModel: config.defaultModel });
const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
    cors: { origin: allowedOrigins === true ? true : allowedOrigins },
});
if (config.trustProxy) {
    const trustProxyValue = /^\d+$/.test(config.trustProxy) ? parseInt(config.trustProxy, 10) : config.trustProxy;
    app.set('trust proxy', trustProxyValue);
}
app.use(cors(corsOptions));
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (isProduction) {
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
});
app.use(express.json({ limit: '3mb' }));
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
}
else {
    // Bootstrap admin's password follows ADMIN_PASSWORD (env), which is authoritative
    // over the persisted hash in the ./data volume — otherwise the hash is frozen at
    // first boot and later .env changes are silently ignored. Re-syncs on mismatch;
    // this overwrites any admin password changed via the UI, so manage the admin
    // secret via env/secrets, not the UI.
    if (!usersRepo.verifyPassword(adminUser, config.adminPassword)) {
        usersRepo.updatePassword(adminUser.id, config.adminPassword);
        log.warn('Admin password re-synced from ADMIN_PASSWORD env');
    }
    else {
        log.info('Admin user already exists');
    }
}
const existingSessions = sessionsRepo.list();
if (existingSessions.length === 0) {
    const session = sessionsRepo.create('Default Session', config.defaultModel);
    try {
        db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run(adminUser.id, session.id);
    }
    catch { }
    log.info('Default session created for admin');
}
else {
    db.prepare("UPDATE sessions SET model = ? WHERE model = 'meta/llama-3.1-405b-instruct'").run(config.defaultModel);
    try {
        db.prepare("UPDATE sessions SET user_id = ? WHERE user_id IS NULL OR user_id = '__migration__'").run(adminUser.id);
        db.prepare("UPDATE messages SET user_id = ? WHERE user_id IS NULL OR user_id = '__migration__'").run(adminUser.id);
        db.prepare("UPDATE tasks SET user_id = ? WHERE user_id IS NULL OR user_id = '__migration__'").run(adminUser.id);
        log.info('Migrated existing records to admin user');
    }
    catch (err) {
        log.warn('Migration of records to admin user failed', { error: err.message });
    }
}
const creditManager = new CreditManager(db, creditsRepo, usersRepo);
const projectsRepo = new ProjectsRepository(db);
const projectRouter = new ProjectRouter(app, projectsRepo, usersRepo);
const approvalManager = new ApprovalManager();
const taskManager = new TaskManager(db, creditManager, approvalManager);
const compactionService = new CompactionService(db);
const dailyCreditBonus = new DailyCreditBonus(db, configRepo, creditsRepo, usersRepo, io);
const fileWatcher = new FileWatcher();
const orchestratorSessionsRepo = new OrchestratorSessionsRepository(db);
const orchestratorStepsRepo = new OrchestratorStepsRepository(db);
const orchestratorStateRepo = new OrchestratorStateRepository(db);
const orchestratorTasksRepo = new OrchestratorTasksRepository(db);
const orchestratorManager = new OrchestratorManager(db, creditManager, projectRouter, projectsRepo, usersRepo);
const orchestratorHeartbeat = new OrchestratorHeartbeat(orchestratorManager, db);
mkdirSync(config.workspaceBaseDir, { recursive: true });
const allUsers = usersRepo.list();
for (const u of allUsers) {
    const userDir = resolve(config.workspaceBaseDir, u.username);
    if (!existsSync(userDir)) {
        mkdirSync(userDir, { recursive: true });
        log.info('Created workspace for user', { username: u.username, dir: userDir });
    }
}
app.use('/api/auth', createAuthRouter(db, authLimiter, refreshLimiter));
app.use('/api/admin', authMiddleware, adminMiddleware, createAdminRouter(db, usersRepo, creditsRepo, projectRouter));
app.use('/api/chat', authMiddleware, createChatRouter(db, taskManager, creditManager, compactionService));
app.use('/api/models', authMiddleware, createModelsRouter(db, configRepo));
app.use('/api/tasks', authMiddleware, createTasksRouter(db, taskManager));
app.use('/api/files', authMiddleware, createFilesRouter(configRepo));
app.use('/api/config', authMiddleware, createConfigRouter(configRepo, adminMiddleware));
app.use('/api/sessions', authMiddleware, createSessionsRouter(db));
app.use('/api/projects', authMiddleware, createProjectsRouter(db, projectRouter));
app.use('/api/orchestrator', authMiddleware, createOrchestratorRouter(orchestratorManager, orchestratorSessionsRepo, orchestratorStepsRepo, orchestratorStateRepo, orchestratorTasksRepo));
app.use('/api/payments', createPaymentsRouter(db, usersRepo, io));
app.use('/p', projectRouter.middleware());
app.get('/health', (_req, res) => {
    const state = orchestratorStateRepo.get();
    res.json({ status: 'ok', orchestrator: { isRunning: state.isRunning, lastHeartbeat: state.lastHeartbeat } });
});
const publicDir = existsSync(join(process.cwd(), 'public'))
    ? join(process.cwd(), 'public')
    : join(process.cwd(), 'frontend', 'dist');
if (existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.get('{*path}', (req, res) => {
        if (/\.\w{1,5}$/.test(req.path)) {
            res.status(404).send('Not Found');
            return;
        }
        res.sendFile(join(publicDir, 'index.html'));
    });
    log.info('Serving static files', { publicDir });
}
else {
    log.warn('No static directory found for frontend');
}
setupWebSocket(io, approvalManager, taskManager, creditManager, orchestratorSessionsRepo);
log.info('WebSocket setup complete');
projectRouter.setIo(io);
orchestratorManager.setIo(io);
dailyCreditBonus.start();
orchestratorHeartbeat.start().catch((err) => log.error('Heartbeat start failed', { error: err.message }));
log.info('Orchestrator heartbeat started');
fileWatcher.start(config.workspaceBaseDir, io, usersRepo);
log.info('File watcher started', { dir: config.workspaceBaseDir });
const allProjects = projectsRepo.listAll();
(async () => {
    for (const p of allProjects) {
        try {
            const pUser = usersRepo.findById(p.userId);
            if (pUser && p.status === 'active') {
                const fullFolderPath = resolveUserWorkspacePath(pUser.username, p.folderPath, { allowRoot: true });
                await projectRouter.mountProject(p, fullFolderPath);
                log.info('Remounted project on startup', { uuid: p.uuid, name: p.name });
            }
        }
        catch (err) {
            log.warn('Failed to remount project on startup', { uuid: p.uuid, error: err.message });
            try {
                projectsRepo.updateStatus(p.id, 'error');
            }
            catch { }
        }
    }
})();
httpServer.listen(config.port, () => {
    log.info(`Web Agent running on http://localhost:${config.port}`);
    log.info('Available routes: /api/auth, /api/admin, /api/chat, /api/models, /api/tasks, /api/files, /api/config, /api/sessions, /api/projects');
});
// Graceful shutdown handler shared by SIGINT and SIGTERM. Docker sends SIGTERM
// on `docker stop`; without a handler the process is force-killed after the
// grace period and the DB close / child-process kill / port release / symlink
// cleanup are skipped, leaving resources pinned and WAL state unflushed.
function gracefulShutdown(signal) {
    log.info(`Shutting down (${signal})...`);
    try {
        orchestratorHeartbeat.stop();
    }
    catch (err) {
        log.warn('Heartbeat stop error', { error: err.message });
    }
    try {
        dailyCreditBonus.stop();
    }
    catch (err) {
        log.warn('DailyCreditBonus stop error', { error: err.message });
    }
    try {
        orchestratorManager.shutdownAll();
    }
    catch (err) {
        log.warn('Orchestrator shutdown error', { error: err.message });
    }
    try {
        fileWatcher.stop();
    }
    catch (err) {
        log.warn('FileWatcher stop error', { error: err.message });
    }
    try {
        projectRouter.shutdownAll();
    }
    catch (err) {
        log.warn('ProjectRouter shutdown error', { error: err.message });
    }
    try {
        db.close();
    }
    catch (err) {
        log.warn('DB close error', { error: err.message });
    }
    process.exit(0);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', { error: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', { reason: String(reason) });
});
//# sourceMappingURL=server.js.map