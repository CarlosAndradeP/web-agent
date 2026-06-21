import { watch } from 'chokidar';
import type { Server } from 'socket.io';

export class FileWatcher {
  private watcher: ReturnType<typeof watch> | null = null;

  start(workspaceDir: string, io: Server): void {
    this.watcher = watch(workspaceDir, {
      ignored: /(^|[/\\])\..|node_modules/,
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('add', (path) => {
      io.emit('file:changed', { path, type: 'create' });
    });

    this.watcher.on('change', (path) => {
      io.emit('file:changed', { path, type: 'modify' });
    });

    this.watcher.on('unlink', (path) => {
      io.emit('file:changed', { path, type: 'delete' });
    });
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
