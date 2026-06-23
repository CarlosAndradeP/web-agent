import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, symlinkSync, unlinkSync, lstatSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { Transform, type TransformCallback } from 'node:stream';
import type { Project } from '../db/repositories/projects.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('ProjectRouter');

let nextNodePort = 9000;

interface ActiveProject {
  project: Project;
  middleware: express.RequestHandler;
  process?: ChildProcess;
  port?: number;
  symlinkPath?: string;
  restartCount: number;
  stopped: boolean;
}

export interface NodeProcessInfo {
  uuid: string;
  name: string;
  projectId: string;
  port: number;
  pid: number | undefined;
  status: 'running' | 'stopped' | 'error';
  username?: string;
}

async function waitForPort(port: number, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
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
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return false;
}

export class ProjectRouter {
  private activeProjects = new Map<string, ActiveProject>();
  private workspaceBaseDir: string;

  constructor(private app: express.Express) {
    this.workspaceBaseDir = process.env.WORKSPACE_BASE_DIR || './workspace';
  }

  middleware(): express.RequestHandler {
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

      if (subPath === undefined || subPath === '') {
        res.redirect(301, `/p/${projectUuid}/${queryString}`);
        return;
      }

      const rewrittenSubPath = `/${subPath}`;
      req.url = rewrittenSubPath + queryString;

      if (active.project.type === 'node') {
        const originalWriteHead = res.writeHead.bind(res);
        const originalEnd = res.end.bind(res);
        const chunks: Buffer[] = [];
        let headersSent = false;
        let isHtml = false;

        const originalWrite = res.write.bind(res);
        res.write = (chunk: any, ...args: any[]): boolean => {
          if (!headersSent) {
            const contentType = res.getHeader('content-type') as string | undefined;
            isHtml = !!contentType && contentType.includes('text/html');
            headersSent = true;
          }
          if (isHtml) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            return true;
          }
          return originalWrite(chunk, ...args);
        };

        res.end = (chunk?: any, ...args: any[]): any => {
          if (!headersSent) {
            const contentType = res.getHeader('content-type') as string | undefined;
            isHtml = !!contentType && contentType.includes('text/html');
          }
          if (isHtml) {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            const fullBody = Buffer.concat(chunks).toString('utf8');
            const baseTag = `<base href="/p/${projectUuid}/">`;
            const injected = fullBody.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
            res.removeHeader('content-length');
            originalEnd(injected, ...args);
            return;
          }
          return originalEnd(chunk, ...args);
        };
      }

      active.middleware(req, res, (err?: any) => {
        if (active.project.type === 'static') {
          res.status(404).send('Not Found');
        } else {
          next(err);
        }
      });
    };
  }

  async mountProject(project: Project, fullFolderPath: string): Promise<void> {
    if (this.activeProjects.has(project.uuid)) {
      log.warn('Project already mounted', { uuid: project.uuid });
      return;
    }

    if (!existsSync(fullFolderPath)) {
      throw new Error(`Folder does not exist: ${fullFolderPath}`);
    }

    let middleware: express.RequestHandler;
    let symlinkPath: string | undefined;

    if (project.type === 'static') {
      middleware = express.static(fullFolderPath);
      log.info('Static project mounted', { uuid: project.uuid, path: fullFolderPath });
    } else if (project.type === 'php') {
      const uuidLinkPath = resolve(this.workspaceBaseDir, project.uuid);
      try {
        if (lstatSync(uuidLinkPath).isSymbolicLink()) {
          unlinkSync(uuidLinkPath);
        }
      } catch {}
      symlinkSync(fullFolderPath, uuidLinkPath, 'junction');
      symlinkPath = uuidLinkPath;

      middleware = createProxyMiddleware({
        target: `http://localhost:8080/${project.uuid}/`,
        changeOrigin: true,
      }) as any;
      log.info('PHP project mounted (proxy to Apache via symlink)', { uuid: project.uuid, symlink: uuidLinkPath, target: fullFolderPath });
    } else if (project.type === 'node') {
      const port = nextNodePort++;
      const active: ActiveProject = {
        project,
        middleware: createProxyMiddleware({
          target: `http://localhost:${port}`,
          changeOrigin: true,
        }) as any,
        port,
        restartCount: 0,
        stopped: false,
      };

      this.activeProjects.set(project.uuid, active);
      try {
        this.spawnAndWatch(project, fullFolderPath, port);
      } catch (err: any) {
        this.activeProjects.delete(project.uuid);
        throw err;
      }

      const ready = await waitForPort(port);
      if (!ready) {
        log.warn('Node project did not become ready in time', { uuid: project.uuid, port });
      } else {
        log.info('Node project ready', { uuid: project.uuid, port });
      }
      return;
    } else {
      throw new Error(`Unknown project type: ${project.type}`);
    }

    this.activeProjects.set(project.uuid, { project, middleware, symlinkPath, restartCount: 0, stopped: false });
  }

  unmountProject(project: Project): void {
    const active = this.activeProjects.get(project.uuid);
    if (!active) return;

    active.stopped = true;

    if (active.process) {
      try {
        active.process.kill('SIGTERM');
        log.info('Node process killed', { uuid: project.uuid, pid: active.process.pid });
      } catch (err: any) {
        log.warn('Failed to kill node process', { uuid: project.uuid, error: err.message });
      }
    }

    if (active.symlinkPath) {
      try {
        if (lstatSync(active.symlinkPath).isSymbolicLink()) {
          unlinkSync(active.symlinkPath);
          log.info('Symlink removed', { path: active.symlinkPath, uuid: project.uuid });
        }
      } catch (err: any) {
        log.warn('Failed to remove symlink', { path: active.symlinkPath, error: err.message });
      }
    }

    this.activeProjects.delete(project.uuid);
    log.info('Project unmounted', { uuid: project.uuid });
  }

  async startProject(project: Project, fullFolderPath: string): Promise<void> {
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
    }) as any;

    const active: ActiveProject = {
      project,
      middleware,
      port,
      restartCount: 0,
      stopped: false,
    };

    this.activeProjects.set(project.uuid, active);
    try {
      this.spawnAndWatch(project, fullFolderPath, port);
    } catch (err: any) {
      this.activeProjects.delete(project.uuid);
      throw err;
    }

    const ready = await waitForPort(port);
    if (!ready) {
      log.warn('Node project did not become ready on start', { uuid: project.uuid, port });
    }
  }

  stopProject(uuid: string): void {
    const active = this.activeProjects.get(uuid);
    if (!active || !active.process) {
      throw new Error('No running Node process for this project');
    }

    active.stopped = true;
    try {
      active.process.kill('SIGTERM');
      log.info('Node process stopped by admin', { uuid, pid: active.process.pid });
    } catch (err: any) {
      log.warn('Failed to stop node process', { uuid, error: err.message });
      throw err;
    }
  }

  getActiveNodeProjects(): NodeProcessInfo[] {
    const result: NodeProcessInfo[] = [];
    for (const [uuid, active] of this.activeProjects) {
      if (active.project.type === 'node') {
        result.push({
          uuid,
          name: active.project.name,
          projectId: active.project.id,
          port: active.port!,
          pid: active.process?.pid,
          status: active.stopped ? 'stopped' : (active.process && !active.process.killed ? 'running' : 'stopped'),
          username: undefined,
        });
      }
    }
    return result;
  }

  shutdownAll(): void {
    for (const [uuid, active] of this.activeProjects) {
      active.stopped = true;
      if (active.process) {
        try {
          active.process.kill('SIGTERM');
        } catch {}
      }
      if (active.symlinkPath) {
        try {
          if (lstatSync(active.symlinkPath).isSymbolicLink()) {
            unlinkSync(active.symlinkPath);
          }
        } catch {}
      }
      this.activeProjects.delete(uuid);
    }
    log.info('All projects shut down');
  }

  getActiveProjects(): Map<string, ActiveProject> {
    return this.activeProjects;
  }

  remountSymlinks(): void {
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
        } catch {}
      }
    }
  }

  private spawnAndWatch(project: Project, fullFolderPath: string, port: number): void {
    const active = this.activeProjects.get(project.uuid);
    if (!active) return;

    let childProcess: ChildProcess;
    try {
      childProcess = this.spawnNodeProject(fullFolderPath, port, project.uuid);
    } catch (err: any) {
      log.error('Failed to spawn Node.js project', { uuid: project.uuid, error: err.message });
      active.stopped = true;
      throw err;
    }
    active.process = childProcess;

    childProcess.on('exit', (code) => {
      log.info('Node project exited', { uuid: project.uuid, exitCode: code });

      if (active.stopped) return;

      if (active.restartCount < 5) {
        active.restartCount++;
        log.info('Restarting Node project after crash', { uuid: project.uuid, restartCount: active.restartCount });
        setTimeout(() => {
          if (!active.stopped && this.activeProjects.has(project.uuid)) {
            this.spawnAndWatch(project, fullFolderPath, port);
          }
        }, 1000);
      } else {
        log.warn('Node project exceeded max restarts', { uuid: project.uuid, restartCount: active.restartCount });
      }
    });
  }

  private spawnNodeProject(folderPath: string, port: number, uuid: string): ChildProcess {
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
        } else if (pkgJson.main) {
          startArgs = [pkgJson.main];
          entryFile = pkgJson.main;
        }
      } catch {}
    }

    if (startCmd === 'node' && entryFile && !existsSync(resolve(folderPath, entryFile))) {
      throw new Error(`Node.js entry point not found: ${entryFile}. Create the file first, then start the project.`);
    }

    const env = { ...process.env, PORT: String(port) };
    const child = spawn(startCmd, startArgs, {
      cwd: folderPath,
      env,
      stdio: 'pipe',
      detached: false,
    });

    child.stdout?.on('data', (data: Buffer) => {
      log.info(`[Node:${uuid}] ${data.toString().trim()}`);
    });

    child.stderr?.on('data', (data: Buffer) => {
      log.warn(`[Node:${uuid}] ${data.toString().trim()}`);
    });

    return child;
  }
}
