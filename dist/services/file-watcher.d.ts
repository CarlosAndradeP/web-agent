import type { Server } from 'socket.io';
import type { UsersRepository } from '../db/repositories/users.js';
export declare class FileWatcher {
    private watcher;
    private workspaceDir;
    private io;
    private usersRepo;
    private usernameToUserId;
    start(workspaceDir: string, io: Server, usersRepo: UsersRepository): void;
    private checkAndEmitNodeDetected;
    stop(): void;
}
//# sourceMappingURL=file-watcher.d.ts.map