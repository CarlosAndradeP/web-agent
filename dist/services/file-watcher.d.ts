import type { Server } from 'socket.io';
export declare class FileWatcher {
    private watcher;
    start(workspaceDir: string, io: Server): void;
    private pathToRoom;
    stop(): void;
}
//# sourceMappingURL=file-watcher.d.ts.map