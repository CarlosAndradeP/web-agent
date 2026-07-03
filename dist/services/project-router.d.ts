import express from 'express';
import { type ChildProcess } from 'node:child_process';
import type { Server } from 'socket.io';
import type { Project, ProjectsRepository } from '../db/repositories/projects.js';
import type { UsersRepository } from '../db/repositories/users.js';
interface ActiveProject {
    project: Project;
    middleware: express.RequestHandler;
    process?: ChildProcess;
    port?: number;
    symlinkPath?: string;
    restartCount: number;
    restartTimer?: ReturnType<typeof setTimeout>;
    stopped: boolean;
}
export interface NodeProcessInfo {
    uuid: string;
    name: string;
    projectId: string;
    port: number;
    pid: number | undefined;
    status: 'running' | 'stopped' | 'error';
    username?: string;
}
export declare class ProjectRouter {
    private app;
    private projectsRepo;
    private usersRepo;
    private activeProjects;
    private workspaceBaseDir;
    private io;
    constructor(app: express.Express, projectsRepo: ProjectsRepository, usersRepo: UsersRepository);
    setIo(io: Server): void;
    middleware(): express.RequestHandler;
    mountProject(project: Project, fullFolderPath: string): Promise<void>;
    unmountProject(project: Project): void;
    startProject(project: Project, fullFolderPath: string): Promise<void>;
    stopProject(uuid: string): void;
    promoteToNode(project: Project, fullFolderPath: string): Promise<void>;
    isNodeProjectDetected(folderPath: string): boolean;
    getActiveNodeProjects(): NodeProcessInfo[];
    shutdownAll(): void;
    getActiveProjects(): Map<string, ActiveProject>;
    remountSymlinks(): void;
    private spawnAndWatch;
    private createNodeProxy;
    private closeProxy;
    private cleanupActive;
    private releaseActivePort;
    private terminateProcess;
    private failNodeProject;
    private spawnNodeProject;
}
export {};
//# sourceMappingURL=project-router.d.ts.map