import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync, symlinkSync, unlinkSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createLogger } from '../services/logger.js';
const log = createLogger('ProjectRouter');
let nextNodePort = 9000;
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
    activeProjects = new Map();
    workspaceBaseDir;
    constructor(app) {
        this.app = app;
        this.workspaceBaseDir = process.env.WORKSPACE_BASE_DIR || './workspace';
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
            middleware = express.static(fullFolderPath);
            log.info('Static project mounted', { uuid: project.uuid, path: fullFolderPath });
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
            const port = nextNodePort++;
            const active = {
                project,
                middleware: createProxyMiddleware({
                    target: `http://localhost:${port}`,
                    changeOrigin: true,
                }),
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
                log.warn('Node project did not become ready in time', { uuid: project.uuid, port });
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
        if (active.process) {
            try {
                active.process.kill('SIGTERM');
                log.info('Node process killed', { uuid: project.uuid, pid: active.process.pid });
            }
            catch (err) {
                log.warn('Failed to kill node process', { uuid: project.uuid, error: err.message });
            }
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
        const port = existing?.port ?? nextNodePort++;
        const middleware = createProxyMiddleware({
            target: `http://localhost:${port}`,
            changeOrigin: true,
        });
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
            this.activeProjects.delete(project.uuid);
            throw err;
        }
        const ready = await waitForPort(port);
        if (!ready) {
            log.warn('Node project did not become ready on start', { uuid: project.uuid, port });
        }
    }
    stopProject(uuid) {
        const active = this.activeProjects.get(uuid);
        if (!active || !active.process) {
            throw new Error('No running Node process for this project');
        }
        active.stopped = true;
        try {
            active.process.kill('SIGTERM');
            log.info('Node process stopped by admin', { uuid, pid: active.process.pid });
        }
        catch (err) {
            log.warn('Failed to stop node process', { uuid, error: err.message });
            throw err;
        }
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
            if (active.project.type === 'php' && active.symlinkPath) {
                const linkPath = active.symlinkPath;
                try {
                    if (!lstatSync(linkPath).isSymbolicLink()) {
                        const fullFolderPath = resolve(this.workspaceBaseDir, active.project.userId, active.project.folderPath);
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
        childProcess.on('exit', (code) => {
            log.info('Node project exited', { uuid: project.uuid, exitCode: code });
            if (active.stopped)
                return;
            if (active.restartCount < 5) {
                active.restartCount++;
                log.info('Restarting Node project after crash', { uuid: project.uuid, restartCount: active.restartCount });
                setTimeout(() => {
                    if (!active.stopped && this.activeProjects.has(project.uuid)) {
                        this.spawnAndWatch(project, fullFolderPath, port);
                    }
                }, 1000);
            }
            else {
                log.warn('Node project exceeded max restarts', { uuid: project.uuid, restartCount: active.restartCount });
            }
        });
    }
    spawnNodeProject(folderPath, port, uuid) {
        log.info('Spawning Node.js project', { folderPath, port, uuid });
        const pkgJsonPath = resolve(folderPath, 'package.json');
        let startCmd = 'node';
        let startArgs = ['index.js'];
        let entryFile = 'index.js';
        if (existsSync(pkgJsonPath)) {
            try {
                const pkgJson = require(pkgJsonPath);
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
            catch { }
        }
        if (startCmd === 'node' && entryFile && !existsSync(resolve(folderPath, entryFile))) {
            throw new Error(`Node.js entry point not found: ${entryFile}. Create the file first, then start the project.`);
        }
        const preloadPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'preload', 'port-force.cjs');
        const env = {
            ...process.env,
            PORT: String(port),
            BASE_PATH: `/p/${uuid}/`,
        };
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