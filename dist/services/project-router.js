import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { spawn } from 'node:child_process';
import { resolve, dirname, extname } from 'node:path';
import { existsSync, symlinkSync, unlinkSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';
import net from 'node:net';
import { createLogger } from '../services/logger.js';
import { buildSafeEnv } from '../agent/tools/command-policy.js';
import { resolveUserWorkspacePath } from '../lib/workspace-paths.js';
const log = createLogger('ProjectRouter');
// createRequire lets us dynamically load a project's package.json from an ESM
// module. Using `require(...)` directly throws ReferenceError in ESM, which
// silently broke script/main detection (it always fell back to index.js).
const projectRequire = createRequire(import.meta.url);
const PORT_MIN = 9000;
const PORT_MAX = 65535;
const MAX_PORT_SCAN_ATTEMPTS = PORT_MAX - PORT_MIN + 1;
const MAX_RESTARTS = 5;
let nextNodePort = PORT_MIN;
const releasedPorts = new Set();
function isPortAvailable(port) {
    return new Promise((resolveAvailability) => {
        const server = net.createServer();
        server.once('error', () => resolveAvailability(false));
        server.once('listening', () => {
            server.close(() => resolveAvailability(true));
        });
        server.listen(port, '127.0.0.1');
    });
}
function nextCandidatePort() {
    // Reuse a released port if available
    for (const port of releasedPorts) {
        releasedPorts.delete(port);
        return port;
    }
    if (nextNodePort > PORT_MAX) {
        // Wrap around and scan for gaps
        nextNodePort = PORT_MIN;
    }
    return nextNodePort++;
}
async function allocatePort() {
    for (let attempt = 0; attempt < MAX_PORT_SCAN_ATTEMPTS; attempt++) {
        const port = nextCandidatePort();
        if (await isPortAvailable(port))
            return port;
    }
    throw new Error('No available Node.js ports');
}
function releasePort(port) {
    releasedPorts.add(port);
}
async function waitForPort(port, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            await new Promise((resolve, reject) => {
                const req = http.get(`http://localhost:${port}/`, (res) => {
                    res.resume();
                    resolve();
                });
                req.on('error', reject);
                req.setTimeout(2000, () => {
                    req.destroy();
                    reject(new Error('timeout'));
                });
            });
            return true;
        }
        catch {
            await new Promise(r => setTimeout(r, 500));
        }
    }
    return false;
}
export class ProjectRouter {
    app;
    projectsRepo;
    usersRepo;
    activeProjects = new Map();
    workspaceBaseDir;
    io = null;
    constructor(app, projectsRepo, usersRepo) {
        this.app = app;
        this.projectsRepo = projectsRepo;
        this.usersRepo = usersRepo;
        this.workspaceBaseDir = process.env.WORKSPACE_BASE_DIR || './workspace';
    }
    setIo(io) {
        this.io = io;
    }
    middleware() {
        return (req, res, next) => {
            const urlPath = req.url;
            const match = urlPath.match(/^\/([^/?]+)(?:\/([^?]*))?(?:\?.*)?$/);
            if (!match) {
                next();
                return;
            }
            const projectUuid = match[1];
            const active = this.activeProjects.get(projectUuid);
            if (!active) {
                next();
                return;
            }
            const subPath = match[2];
            const queryString = urlPath.includes('?') ? urlPath.slice(urlPath.indexOf('?')) : '';
            if (subPath === undefined) {
                res.redirect(301, `/p/${projectUuid}/${queryString}`);
                return;
            }
            const rewrittenSubPath = subPath === '' ? '/' : `/${subPath}`;
            req.url = rewrittenSubPath + queryString;
            if (active.project.type === 'node') {
                const originalWriteHead = res.writeHead.bind(res);
                const originalEnd = res.end.bind(res);
                const chunks = [];
                let headersSent = false;
                let isHtml = false;
                const basePath = `/p/${projectUuid}/`;
                const originalWrite = res.write.bind(res);
                res.write = (chunk, ...args) => {
                    if (!headersSent) {
                        const contentType = res.getHeader('content-type');
                        isHtml = !!contentType && contentType.includes('text/html');
                        headersSent = true;
                    }
                    if (isHtml) {
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                        return true;
                    }
                    return originalWrite(chunk, ...args);
                };
                res.end = (chunk, ...args) => {
                    if (!headersSent) {
                        const contentType = res.getHeader('content-type');
                        isHtml = !!contentType && contentType.includes('text/html');
                    }
                    if (isHtml) {
                        if (chunk)
                            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                        const fullBody = Buffer.concat(chunks).toString('utf8');
                        const headInjection = `<base href="${basePath}"><script>window.__BASE_PATH__="${basePath}";</script>`;
                        let injected = fullBody.replace(/<head([^>]*)>/i, `<head$1>${headInjection}`);
                        if (!injected.includes(headInjection)) {
                            injected = headInjection + injected;
                        }
                        res.removeHeader('content-length');
                        originalEnd(injected, ...args);
                        return;
                    }
                    return originalEnd(chunk, ...args);
                };
            }
            active.middleware(req, res, (err) => {
                if (active.project.type === 'static') {
                    res.status(404).send('Not Found');
                }
                else {
                    next(err);
                }
            });
        };
    }
    async mountProject(project, fullFolderPath) {
        if (this.activeProjects.has(project.uuid)) {
            log.warn('Project already mounted', { uuid: project.uuid });
            return;
        }
        if (!existsSync(fullFolderPath)) {
            throw new Error(`Folder does not exist: ${fullFolderPath}`);
        }
        let middleware;
        let symlinkPath;
        if (project.type === 'static') {
            const staticMiddleware = express.static(fullFolderPath);
            const phpProxy = createProxyMiddleware({
                target: `http://localhost:8080/${project.uuid}/`,
                changeOrigin: true,
            });
            middleware = (req, res, next) => {
                const urlExt = extname(req.path);
                if (urlExt === '.php') {
                    phpProxy(req, res, next);
                    return;
                }
                staticMiddleware(req, res, (err) => {
                    if (res.headersSent)
                        return;
                    phpProxy(req, res, next);
                });
            };
            log.info('Static project mounted (dual: express.static + Apache proxy for PHP)', { uuid: project.uuid, path: fullFolderPath });
            const uuidLinkPath = resolve(this.workspaceBaseDir, project.uuid);
            try {
                if (lstatSync(uuidLinkPath).isSymbolicLink()) {
                    unlinkSync(uuidLinkPath);
                }
            }
            catch { }
            try {
                symlinkSync(fullFolderPath, uuidLinkPath, 'junction');
                symlinkPath = uuidLinkPath;
                log.info('Static project symlink created for Apache/PHP compat', { uuid: project.uuid, symlink: uuidLinkPath });
            }
            catch (err) {
                log.warn('Failed to create symlink for static project (non-fatal)', { uuid: project.uuid, error: err.message });
            }
        }
        else if (project.type === 'php') {
            const uuidLinkPath = resolve(this.workspaceBaseDir, project.uuid);
            try {
                if (lstatSync(uuidLinkPath).isSymbolicLink()) {
                    unlinkSync(uuidLinkPath);
                }
            }
            catch { }
            symlinkSync(fullFolderPath, uuidLinkPath, 'junction');
            symlinkPath = uuidLinkPath;
            middleware = createProxyMiddleware({
                target: `http://localhost:8080/${project.uuid}/`,
                changeOrigin: true,
            });
            log.info('PHP project mounted (proxy to Apache via symlink)', { uuid: project.uuid, symlink: uuidLinkPath, target: fullFolderPath });
        }
        else if (project.type === 'node') {
            const port = await allocatePort();
            const active = {
                project,
                middleware: this.createNodeProxy(port),
                port,
                restartCount: 0,
                stopped: false,
            };
            this.activeProjects.set(project.uuid, active);
            try {
                this.spawnAndWatch(project, fullFolderPath, port);
            }
            catch (err) {
                this.activeProjects.delete(project.uuid);
                throw err;
            }
            const ready = await waitForPort(port);
            if (!ready) {
                const error = `Node project did not become ready on port ${port}`;
                this.failNodeProject(project, active, error);
                throw new Error(error);
            }
            else {
                log.info('Node project ready', { uuid: project.uuid, port });
            }
            return;
        }
        else {
            throw new Error(`Unknown project type: ${project.type}`);
        }
        this.activeProjects.set(project.uuid, { project, middleware, symlinkPath, restartCount: 0, stopped: false });
    }
    unmountProject(project) {
        const active = this.activeProjects.get(project.uuid);
        if (!active)
            return;
        active.stopped = true;
        // Cancel any pending restart timer so it does not live up to 30s in the
        // event loop after the project is unmounted (which would delay a clean
        // server shutdown by up to the max backoff).
        if (active.restartTimer) {
            clearTimeout(active.restartTimer);
            active.restartTimer = undefined;
        }
        this.closeProxy(active);
        if (active.process) {
            this.terminateProcess(active.process, project.uuid, 'unmount');
        }
        // Release port back to the pool
        if (active.port) {
            this.releaseActivePort(active);
        }
        if (active.symlinkPath) {
            try {
                if (lstatSync(active.symlinkPath).isSymbolicLink()) {
                    unlinkSync(active.symlinkPath);
                    log.info('Symlink removed', { path: active.symlinkPath, uuid: project.uuid });
                }
            }
            catch (err) {
                log.warn('Failed to remove symlink', { path: active.symlinkPath, error: err.message });
            }
        }
        this.activeProjects.delete(project.uuid);
        log.info('Project unmounted', { uuid: project.uuid });
    }
    async startProject(project, fullFolderPath) {
        if (project.type !== 'node') {
            throw new Error('Only Node.js projects can be started/stopped');
        }
        const existing = this.activeProjects.get(project.uuid);
        if (existing && !existing.stopped) {
            throw new Error('Project is already running');
        }
        if (!existsSync(fullFolderPath)) {
            throw new Error(`Folder does not exist: ${fullFolderPath}`);
        }
        if (existing)
            this.cleanupActive(project.uuid, existing, { releasePort: false });
        const port = await allocatePort();
        const middleware = this.createNodeProxy(port);
        const active = {
            project,
            middleware,
            port,
            restartCount: 0,
            stopped: false,
        };
        this.activeProjects.set(project.uuid, active);
        try {
            this.spawnAndWatch(project, fullFolderPath, port);
        }
        catch (err) {
            this.cleanupActive(project.uuid, active);
            throw err;
        }
        const ready = await waitForPort(port);
        if (!ready) {
            const error = `Node project did not become ready on port ${port}`;
            this.failNodeProject(project, active, error);
            throw new Error(error);
        }
    }
    stopProject(uuid) {
        const active = this.activeProjects.get(uuid);
        if (!active || !active.process) {
            throw new Error('No running Node process for this project');
        }
        active.stopped = true;
        if (active.restartTimer) {
            clearTimeout(active.restartTimer);
            active.restartTimer = undefined;
        }
        this.closeProxy(active);
        try {
            this.terminateProcess(active.process, uuid, 'stop');
            log.info('Node process stopped by admin', { uuid, pid: active.process.pid });
        }
        catch (err) {
            log.warn('Failed to stop node process', { uuid, error: err.message });
            throw err;
        }
        // Release port back to the pool
        if (active.port) {
            this.releaseActivePort(active);
        }
        this.activeProjects.delete(uuid);
        try {
            this.projectsRepo.updatePort(active.project.id, null);
        }
        catch { }
        try {
            this.projectsRepo.updatePid(active.project.id, null);
        }
        catch { }
    }
    async promoteToNode(project, fullFolderPath) {
        this.unmountProject(project);
        // Use allocatePort() so the promote path reuses released ports and
        // respects the wraparound/PORT_MAX bounds. Directly mutating nextNodePort
        // was bypassing the released-ports pool and could yield port 65536.
        const port = await allocatePort();
        const middleware = this.createNodeProxy(port);
        const active = {
            project: { ...project, type: 'node' },
            middleware,
            port,
            restartCount: 0,
            stopped: false,
        };
        this.activeProjects.set(project.uuid, active);
        try {
            this.spawnAndWatch({ ...project, type: 'node' }, fullFolderPath, port);
        }
        catch (err) {
            this.cleanupActive(project.uuid, active);
            throw err;
        }
        const ready = await waitForPort(port);
        if (!ready) {
            const error = `Promoted Node project did not become ready on port ${port}`;
            this.failNodeProject(active.project, active, error);
            throw new Error(error);
        }
        else {
            log.info('Promoted Node project ready', { uuid: project.uuid, port });
        }
    }
    isNodeProjectDetected(folderPath) {
        const pkgJsonPath = resolve(folderPath, 'package.json');
        return existsSync(pkgJsonPath);
    }
    getActiveNodeProjects() {
        const result = [];
        for (const [uuid, active] of this.activeProjects) {
            if (active.project.type === 'node') {
                result.push({
                    uuid,
                    name: active.project.name,
                    projectId: active.project.id,
                    port: active.port,
                    pid: active.process?.pid,
                    status: active.stopped ? 'stopped' : (active.process && !active.process.killed ? 'running' : 'stopped'),
                    username: undefined,
                });
            }
        }
        return result;
    }
    shutdownAll() {
        for (const [uuid, active] of this.activeProjects) {
            active.stopped = true;
            if (active.restartTimer) {
                clearTimeout(active.restartTimer);
                active.restartTimer = undefined;
            }
            if (active.process) {
                try {
                    active.process.kill('SIGTERM');
                }
                catch { }
            }
            if (active.symlinkPath) {
                try {
                    if (lstatSync(active.symlinkPath).isSymbolicLink()) {
                        unlinkSync(active.symlinkPath);
                    }
                }
                catch { }
            }
            this.activeProjects.delete(uuid);
        }
        log.info('All projects shut down');
    }
    getActiveProjects() {
        return this.activeProjects;
    }
    remountSymlinks() {
        for (const [uuid, active] of this.activeProjects) {
            if ((active.project.type === 'php' || active.project.type === 'static') && active.symlinkPath) {
                const linkPath = active.symlinkPath;
                try {
                    if (!lstatSync(linkPath).isSymbolicLink()) {
                        const user = this.usersRepo.findById(active.project.userId);
                        if (!user)
                            continue;
                        const fullFolderPath = resolveUserWorkspacePath(user.username, active.project.folderPath, { allowRoot: true });
                        if (existsSync(fullFolderPath)) {
                            symlinkSync(fullFolderPath, linkPath, 'junction');
                            log.info('Recreated symlink on startup', { uuid, path: linkPath });
                        }
                    }
                }
                catch { }
            }
        }
    }
    spawnAndWatch(project, fullFolderPath, port) {
        const active = this.activeProjects.get(project.uuid);
        if (!active)
            return;
        let childProcess;
        try {
            childProcess = this.spawnNodeProject(fullFolderPath, port, project.uuid);
        }
        catch (err) {
            log.error('Failed to spawn Node.js project', { uuid: project.uuid, error: err.message });
            active.stopped = true;
            throw err;
        }
        active.process = childProcess;
        try {
            this.projectsRepo.updatePort(project.id, port);
        }
        catch { }
        try {
            this.projectsRepo.updatePid(project.id, childProcess.pid ?? null);
        }
        catch { }
        childProcess.on('exit', (code) => {
            log.info('Node project exited', { uuid: project.uuid, exitCode: code });
            try {
                this.projectsRepo.updatePid(project.id, null);
            }
            catch { }
            if (active.stopped)
                return;
            if (active.restartCount < MAX_RESTARTS) {
                active.restartCount++;
                const delay = Math.min(1000 * Math.pow(2, active.restartCount - 1), 30000);
                log.info('Restarting Node project after crash', { uuid: project.uuid, restartCount: active.restartCount, delayMs: delay });
                active.restartTimer = setTimeout(async () => {
                    active.restartTimer = undefined;
                    if (!active.stopped && this.activeProjects.has(project.uuid)) {
                        try {
                            if (active.port)
                                releasePort(active.port);
                            const nextPort = await allocatePort();
                            active.port = nextPort;
                            active.middleware = this.createNodeProxy(nextPort);
                            this.spawnAndWatch(project, fullFolderPath, nextPort);
                        }
                        catch (err) {
                            this.failNodeProject(project, active, `Failed to restart Node.js project: ${err.message}`);
                        }
                    }
                }, delay);
            }
            else {
                this.failNodeProject(project, active, `Node project exceeded max restarts (${MAX_RESTARTS})`);
            }
        });
    }
    createNodeProxy(port) {
        return createProxyMiddleware({
            target: `http://localhost:${port}`,
            changeOrigin: true,
        });
    }
    closeProxy(active) {
        try {
            active.middleware.close?.();
        }
        catch (err) {
            log.warn('Failed to close project proxy', { uuid: active.project.uuid, error: err.message });
        }
    }
    cleanupActive(uuid, active, options = {}) {
        active.stopped = true;
        if (active.restartTimer) {
            clearTimeout(active.restartTimer);
            active.restartTimer = undefined;
        }
        this.closeProxy(active);
        if (active.port && options.releasePort !== false)
            this.releaseActivePort(active);
        this.activeProjects.delete(uuid);
    }
    releaseActivePort(active) {
        const port = active.port;
        if (!port)
            return;
        active.port = undefined;
        const child = active.process;
        if (child && child.exitCode === null) {
            const releaseTimer = setTimeout(() => releasePort(port), 6000);
            if (releaseTimer.unref)
                releaseTimer.unref();
            child.once('close', () => {
                clearTimeout(releaseTimer);
                releasePort(port);
            });
            return;
        }
        releasePort(port);
    }
    terminateProcess(process, uuid, reason) {
        if (process.killed)
            return;
        process.kill('SIGTERM');
        const killTimer = setTimeout(() => {
            if (!process.killed && process.exitCode === null) {
                try {
                    process.kill('SIGKILL');
                    log.warn('Escalated Node process kill to SIGKILL', { uuid, pid: process.pid, reason });
                }
                catch (err) {
                    log.warn('Failed to SIGKILL Node process', { uuid, pid: process.pid, reason, error: err.message });
                }
            }
        }, 5000);
        if (killTimer.unref)
            killTimer.unref();
    }
    failNodeProject(project, active, error) {
        log.warn('Node project failed permanently', { uuid: project.uuid, projectId: project.id, error });
        if (active.process)
            this.terminateProcess(active.process, project.uuid, 'failure');
        this.cleanupActive(project.uuid, active);
        try {
            this.projectsRepo.updateStatus(project.id, 'error');
        }
        catch (err) {
            log.warn('Failed to update project status after Node failure', { projectId: project.id, error: err.message });
        }
        try {
            this.projectsRepo.updatePort(project.id, null);
        }
        catch { }
        try {
            this.projectsRepo.updatePid(project.id, null);
        }
        catch { }
        this.io?.to(`user:${project.userId}`).emit('project:error', { projectId: project.id, uuid: project.uuid, error });
    }
    spawnNodeProject(folderPath, port, uuid) {
        log.info('Spawning Node.js project', { folderPath, port, uuid });
        const pkgJsonPath = resolve(folderPath, 'package.json');
        let startCmd = 'node';
        let startArgs = ['index.js'];
        let entryFile = 'index.js';
        if (existsSync(pkgJsonPath)) {
            try {
                const pkgJson = projectRequire(pkgJsonPath);
                if (pkgJson.scripts?.start) {
                    startCmd = 'npm';
                    startArgs = ['start'];
                    entryFile = '';
                }
                else if (pkgJson.main) {
                    startArgs = [pkgJson.main];
                    entryFile = pkgJson.main;
                }
            }
            catch (err) {
                log.warn('Failed to parse package.json, falling back to index.js', { uuid, folderPath, error: err.message });
            }
        }
        if (startCmd === 'node' && entryFile && !existsSync(resolve(folderPath, entryFile))) {
            throw new Error(`Node.js entry point not found: ${entryFile}. Create the file first, then start the project.`);
        }
        const preloadPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'preload', 'port-force.cjs');
        const env = buildSafeEnv({
            PORT: String(port),
            BASE_PATH: `/p/${uuid}/`,
        });
        if (startCmd === 'npm') {
            const existingNodeOptions = env.NODE_OPTIONS || '';
            const preloadOpt = `--require "${preloadPath}"`;
            env.NODE_OPTIONS = existingNodeOptions
                ? `${existingNodeOptions} ${preloadOpt}`
                : preloadOpt;
        }
        const spawnArgs = startCmd === 'node'
            ? ['-r', preloadPath, ...startArgs]
            : startArgs;
        const child = spawn(startCmd, spawnArgs, {
            cwd: folderPath,
            env,
            stdio: 'pipe',
            detached: false,
        });
        child.stdout?.on('data', (data) => {
            log.info(`[Node:${uuid}] ${data.toString().trim()}`);
        });
        child.stderr?.on('data', (data) => {
            log.warn(`[Node:${uuid}] ${data.toString().trim()}`);
        });
        return child;
    }
}
//# sourceMappingURL=project-router.js.map