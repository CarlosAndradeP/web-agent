import { watch } from 'chokidar';
import type { Server } from 'socket.io';
import { relative, basename, dirname } from 'node:path';
import { createLogger } from './logger.js';
import type { UsersRepository } from '../db/repositories/users.js';

const log = createLogger('FileWatcher');

export class FileWatcher {
  private watcher: ReturnType<typeof watch> | null = null;
  private workspaceDir: string = '';
  private io: Server | null = null;
  private usersRepo: UsersRepository | null = null;
  // Cache username -> userId since username dirs rarely change and a DB
  // lookup per file change is wasteful.
  private usernameToUserId = new Map<string, string | null>();

  start(workspaceDir: string, io: Server, usersRepo: UsersRepository): void {
    this.workspaceDir = workspaceDir;
    this.io = io;
    this.usersRepo = usersRepo;
    log.info('Starting file watcher', { workspaceDir });
    this.watcher = watch(workspaceDir, {
      ignored: /(^|[/\\])\..|node_modules/,
      persistent: true,
      ignoreInitial: true,
    });

    const userRoomFor = (filePath: string): string | null => {
      // Socket clients join `user:<userId>` rooms (see websocket/events.ts).
      // The old code emitted to `workspace:<username>` rooms that no client
      // ever joined — file:changed events were silently lost.
      if (!this.usersRepo) return null;
      const rel = relative(this.workspaceDir, filePath);
      const parts = rel.split(/[/\\]/);
      if (parts.length === 0 || !parts[0]) return null;
      const username = parts[0];
      let userId = this.usernameToUserId.get(username);
      if (userId === undefined) {
        const u = this.usersRepo.findByUsername(username);
        userId = u ? u.id : null;
        this.usernameToUserId.set(username, userId);
      }
      return userId ? `user:${userId}` : null;
    };

    const emitFileChanged = (filePath: string, type: 'create' | 'modify' | 'delete') => {
      const room = userRoomFor(filePath);
      const emitter = room && this.io ? this.io.to(room) : this.io;
      if (emitter) emitter.emit('file:changed', { path: filePath, type });
    };

    this.watcher.on('add', (path) => {
      log.debug('File added', { path });
      emitFileChanged(path, 'create');
      if (basename(path) === 'package.json') {
        this.checkAndEmitNodeDetected(path, userRoomFor(path));
      }
    });

    this.watcher.on('change', (path) => {
      log.debug('File changed', { path });
      emitFileChanged(path, 'modify');
      if (basename(path) === 'package.json') {
        this.checkAndEmitNodeDetected(path, userRoomFor(path));
      }
    });

    this.watcher.on('unlink', (path) => {
      log.debug('File deleted', { path });
      emitFileChanged(path, 'delete');
    });

    this.watcher.on('error', (err: unknown) => {
      log.error('File watcher error', { error: err instanceof Error ? err.message : String(err) });
    });
  }

  private checkAndEmitNodeDetected(pkgJsonPath: string, userRoom: string | null): void {
    if (!this.io) return;
    const folderPath = dirname(pkgJsonPath);
    const rel = relative(this.workspaceDir, folderPath);
    const parts = rel.split(/[/\\]/);
    if (parts.length >= 2) {
      const username = parts[0];
      const projectRelPath = parts.slice(1).join('/');
      // Scope the event to the owning user's room so other connected users do
      // not see another user's project folder paths.
      const emitter = userRoom ? this.io.to(userRoom) : this.io;
      emitter.emit('project:node-detected', {
        folderPath: projectRelPath,
        username,
        fullPath: folderPath,
      });
      log.info('Node.js project detected (package.json created)', { folderPath: projectRelPath, username });
    }
  }

  stop(): void {
    log.info('Stopping file watcher');
    this.watcher?.close();
    this.watcher = null;
    this.usersRepo = null;
    this.usernameToUserId.clear();
  }
}
