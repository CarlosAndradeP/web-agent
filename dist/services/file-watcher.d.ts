import type { Server } from 'socket.io';
export declare class FileWatcher {
    private watcher;
    private workspaceDir;
    private io;
    start(workspaceDir: string, io: Server): void;
    private checkAndEmitNodeDetected;
    private pathToRoom;
    stop(): void;
}
//# sourceMappingURL=file-watcher.d.ts.map