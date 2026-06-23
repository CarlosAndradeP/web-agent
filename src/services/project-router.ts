import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, symlinkSync, unlinkSync, lstatSync, readdirSync } from 'node:fs';
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

      const queryString = urlPath.includes('?') ? urlPath.slice(urlPath.indexOf('?')) : '';
      const subPath = match[2] !== undefined && match[2] !== '' ? `/${match[2]}` : '/';
      req.url = subPath + queryString;

      active.middleware(req, res, (err?: any) => {
        if (active.project.type === 'static') {
          res.status(404).send('Not Found');
        } else {
          next(err);
        }
      });
    };
  }

  mountProject(project: Project, fullFolderPath: string): void {
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
      const childProcess = this.spawnNodeProject(fullFolderPath, port, project.uuid);

      middleware = createProxyMiddleware({
        target: `http://localhost:${port}`,
        changeOrigin: true,
      }) as any;

      this.activeProjects.set(project.uuid, { project, middleware, process: childProcess, port, symlinkPath });
      log.info('Node project mounted', { uuid: project.uuid, port });
      return;
    } else {
      throw new Error(`Unknown project type: ${project.type}`);
    }

    this.activeProjects.set(project.uuid, { project, middleware, symlinkPath });
  }

  unmountProject(project: Project): void {
    const active = this.activeProjects.get(project.uuid);
    if (!active) return;

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

  shutdownAll(): void {
    for (const [uuid, active] of this.activeProjects) {
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

  private spawnNodeProject(folderPath: string, port: number, uuid: string): ChildProcess {
    log.info('Spawning Node.js project', { folderPath, port, uuid });

    const pkgJsonPath = resolve(folderPath, 'package.json');
    let startCmd = 'node';
    let startArgs = ['index.js'];

    if (existsSync(pkgJsonPath)) {
      try {
        const pkgJson = require(pkgJsonPath);
        if (pkgJson.scripts?.start) {
          startCmd = 'npm';
          startArgs = ['start'];
        } else if (pkgJson.main) {
          startArgs = [pkgJson.main];
        }
      } catch {}
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

    child.on('exit', (code) => {
      log.info(`Node project exited`, { uuid, exitCode: code });
    });

    return child;
  }
}
