import { watch } from 'chokidar';
import type { Server } from 'socket.io';
import { createLogger } from '../services/logger.js';

const log = createLogger('FileWatcher');

export class FileWatcher {
  private watcher: ReturnType<typeof watch> | null = null;

  start(workspaceDir: string, io: Server): void {
    log.info('Starting file watcher', { workspaceDir });
    this.watcher = watch(workspaceDir, {
      ignored: /(^|[/\\])\..|node_modules/,
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('add', (path) => {
      log.debug('File added', { path });
      io.emit('file:changed', { path, type: 'create' });
    });

    this.watcher.on('change', (path) => {
      log.debug('File changed', { path });
      io.emit('file:changed', { path, type: 'modify' });
    });

    this.watcher.on('unlink', (path) => {
      log.debug('File deleted', { path });
      io.emit('file:changed', { path, type: 'delete' });
    });

    this.watcher.on('error', (err: unknown) => {
      log.error('File watcher error', { error: err instanceof Error ? err.message : String(err) });
    });
  }

  stop(): void {
    log.info('Stopping file watcher');
    this.watcher?.close();
    this.watcher = null;
  }
}
