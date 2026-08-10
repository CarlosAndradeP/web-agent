import { watch } from 'chokidar';
import { relative, basename, dirname } from 'node:path';
import { createLogger } from './logger.js';
const log = createLogger('FileWatcher');
export class FileWatcher {
    watcher = null;
    workspaceDir = '';
    io = null;
    usersRepo = null;
    // Cache username -> userId since username dirs rarely change and a DB
    // lookup per file change is wasteful.
    usernameToUserId = new Map();
    start(workspaceDir, io, usersRepo) {
        this.workspaceDir = workspaceDir;
        this.io = io;
        this.usersRepo = usersRepo;
        log.info('Starting file watcher', { workspaceDir });
        this.watcher = watch(workspaceDir, {
            ignored: /(^|[/\\])\..|node_modules/,
            persistent: true,
            ignoreInitial: true,
        });
        const userRoomFor = (filePath) => {
            // Socket clients join `user:<userId>` rooms (see websocket/events.ts).
            // The old code emitted to `workspace:<username>` rooms that no client
            // ever joined — file:changed events were silently lost.
            if (!this.usersRepo)
                return null;
            const rel = relative(this.workspaceDir, filePath);
            const parts = rel.split(/[/\\]/);
            if (parts.length === 0 || !parts[0])
                return null;
            const username = parts[0];
            let userId = this.usernameToUserId.get(username);
            if (userId === undefined) {
                const u = this.usersRepo.findByUsername(username);
                userId = u ? u.id : null;
                this.usernameToUserId.set(username, userId);
            }
            return userId ? `user:${userId}` : null;
        };
        const emitFileChanged = (filePath, type) => {
            const room = userRoomFor(filePath);
            if (!room || !this.io)
                return;
            const parts = relative(this.workspaceDir, filePath).split(/[/\\]/);
            const workspaceRelativePath = parts.slice(1).join('/');
            if (!workspaceRelativePath)
                return;
            this.io.to(room).emit('file:changed', { path: workspaceRelativePath, type });
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
        this.watcher.on('addDir', (path) => {
            log.debug('Directory added', { path });
            emitFileChanged(path, 'create');
        });
        this.watcher.on('unlinkDir', (path) => {
            log.debug('Directory deleted', { path });
            emitFileChanged(path, 'delete');
        });
        this.watcher.on('error', (err) => {
            log.error('File watcher error', { error: err instanceof Error ? err.message : String(err) });
        });
    }
    checkAndEmitNodeDetected(pkgJsonPath, userRoom) {
        if (!this.io)
            return;
        const folderPath = dirname(pkgJsonPath);
        const rel = relative(this.workspaceDir, folderPath);
        const parts = rel.split(/[/\\]/);
        if (parts.length >= 2) {
            const username = parts[0];
            const projectRelPath = parts.slice(1).join('/');
            // Scope the event to the owning user's room so other connected users do
            // not see another user's project folder paths.
            if (!userRoom)
                return;
            this.io.to(userRoom).emit('project:node-detected', {
                folderPath: projectRelPath,
            });
            log.info('Node.js project detected (package.json created)', { folderPath: projectRelPath, username });
        }
    }
    stop() {
        log.info('Stopping file watcher');
        this.watcher?.close();
        this.watcher = null;
        this.usersRepo = null;
        this.usernameToUserId.clear();
    }
}
//# sourceMappingURL=file-watcher.js.map