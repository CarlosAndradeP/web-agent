import type Database from 'better-sqlite3';
export interface Project {
    id: string;
    uuid: string;
    userId: string;
    name: string;
    folderPath: string;
    type: 'static' | 'php' | 'node';
    port: number | null;
    pid: number | null;
    status: 'active' | 'stopped' | 'error';
    sessionId: string | null;
    createdAt: string;
    updatedAt: string;
}
export declare class ProjectsRepository {
    private db;
    constructor(db: Database.Database);
    create(userId: string, name: string, folderPath: string, type: Project['type'], sessionId?: string, status?: Project['status']): Project;
    findById(id: string): Project | undefined;
    findByUuid(uuid: string): Project | undefined;
    findByUserId(userId: string): Project[];
    listAll(): Project[];
    updateStatus(id: string, status: Project['status']): void;
    updatePort(id: string, port: number | null): void;
    updatePid(id: string, pid: number | null): void;
    delete(id: string): void;
    countByUserId(userId: string): number;
    private mapRow;
}
//# sourceMappingURL=projects.d.ts.map