import type Database from 'better-sqlite3';
import type { AppConfig, AppConfigPublic } from '../../types/index.js';
export declare class ConfigRepository {
    private db;
    constructor(db: Database.Database);
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    getAll(): AppConfig;
    /** Returns config without sensitive fields (apiKey) — safe for non-admin users */
    getPublic(): AppConfigPublic;
    updateAll(data: Partial<AppConfig>): void;
}
//# sourceMappingURL=config.d.ts.map