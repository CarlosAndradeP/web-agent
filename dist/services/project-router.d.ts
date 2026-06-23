import express from 'express';
import { type ChildProcess } from 'node:child_process';
import type { Project } from '../db/repositories/projects.js';
interface ActiveProject {
    project: Project;
    middleware: express.RequestHandler;
    process?: ChildProcess;
    port?: number;
    symlinkPath?: string;
    restartCount: number;
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
    private activeProjects;
    private workspaceBaseDir;
    constructor(app: express.Express);
    middleware(): express.RequestHandler;
    mountProject(project: Project, fullFolderPath: string): Promise<void>;
    unmountProject(project: Project): void;
    startProject(project: Project, fullFolderPath: string): Promise<void>;
    stopProject(uuid: string): void;
    getActiveNodeProjects(): NodeProcessInfo[];
    shutdownAll(): void;
    getActiveProjects(): Map<string, ActiveProject>;
    remountSymlinks(): void;
    private spawnAndWatch;
    private spawnNodeProject;
}
export {};
//# sourceMappingURL=project-router.d.ts.map