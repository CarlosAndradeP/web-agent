import { watch } from 'chokidar';
import type { Server } from 'socket.io';
import { relative, basename, dirname } from 'node:path';
import { createLogger } from '../services/logger.js';

const log = createLogger('FileWatcher');

export class FileWatcher {
  private watcher: ReturnType<typeof watch> | null = null;
  private workspaceDir: string = '';
  private io: Server | null = null;

  start(workspaceDir: string, io: Server): void {
    this.workspaceDir = workspaceDir;
    this.io = io;
    log.info('Starting file watcher', { workspaceDir });
    this.watcher = watch(workspaceDir, {
      ignored: /(^|[/\\])\..|node_modules/,
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('add', (path) => {
      log.debug('File added', { path });
      const room = this.pathToRoom(path, workspaceDir);
      const emitter = room ? io.to(room) : io;
      emitter.emit('file:changed', { path, type: 'create' });

      if (basename(path) === 'package.json') {
        this.checkAndEmitNodeDetected(path);
      }
    });

    this.watcher.on('change', (path) => {
      log.debug('File changed', { path });
      const room = this.pathToRoom(path, workspaceDir);
      const emitter = room ? io.to(room) : io;
      emitter.emit('file:changed', { path, type: 'modify' });

      if (basename(path) === 'package.json') {
        this.checkAndEmitNodeDetected(path);
      }
    });

    this.watcher.on('unlink', (path) => {
      log.debug('File deleted', { path });
      const room = this.pathToRoom(path, workspaceDir);
      const emitter = room ? io.to(room) : io;
      emitter.emit('file:changed', { path, type: 'delete' });
    });

    this.watcher.on('error', (err: unknown) => {
      log.error('File watcher error', { error: err instanceof Error ? err.message : String(err) });
    });
  }

  private checkAndEmitNodeDetected(pkgJsonPath: string): void {
    if (!this.io) return;
    const folderPath = dirname(pkgJsonPath);
    const rel = relative(this.workspaceDir, folderPath);
    const parts = rel.split(/[/\\]/);
    if (parts.length >= 2) {
      const username = parts[0];
      const projectRelPath = parts.slice(1).join('/');
      this.io.emit('project:node-detected', {
        folderPath: projectRelPath,
        username,
        fullPath: folderPath,
      });
      log.info('Node.js project detected (package.json created)', { folderPath: projectRelPath, username });
    }
  }

  private pathToRoom(filePath: string, workspaceDir: string): string | null {
    const rel = relative(workspaceDir, filePath);
    const parts = rel.split(/[/\\]/);
    if (parts.length > 0 && parts[0]) {
      return `workspace:${parts[0]}`;
    }
    return null;
  }

  stop(): void {
    log.info('Stopping file watcher');
    this.watcher?.close();
    this.watcher = null;
  }
}
