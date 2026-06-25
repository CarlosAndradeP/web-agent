import { watch } from 'chokidar';
import { relative } from 'node:path';
import { createLogger } from '../services/logger.js';
const log = createLogger('FileWatcher');
export class FileWatcher {
    watcher = null;
    start(workspaceDir, io) {
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
        });
        this.watcher.on('change', (path) => {
            log.debug('File changed', { path });
            const room = this.pathToRoom(path, workspaceDir);
            const emitter = room ? io.to(room) : io;
            emitter.emit('file:changed', { path, type: 'modify' });
        });
        this.watcher.on('unlink', (path) => {
            log.debug('File deleted', { path });
            const room = this.pathToRoom(path, workspaceDir);
            const emitter = room ? io.to(room) : io;
            emitter.emit('file:changed', { path, type: 'delete' });
        });
        this.watcher.on('error', (err) => {
            log.error('File watcher error', { error: err instanceof Error ? err.message : String(err) });
        });
    }
    pathToRoom(filePath, workspaceDir) {
        const rel = relative(workspaceDir, filePath);
        const parts = rel.split(/[/\\]/);
        if (parts.length > 0 && parts[0]) {
            return `workspace:${parts[0]}`;
        }
        return null;
    }
    stop() {
        log.info('Stopping file watcher');
        this.watcher?.close();
        this.watcher = null;
    }
}
//# sourceMappingURL=file-watcher.js.map