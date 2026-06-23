import type Database from 'better-sqlite3';
import type { AppConfig } from '../../types/index.js';
export declare class ConfigRepository {
    private db;
    constructor(db: Database.Database);
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    getAll(): AppConfig;
    updateAll(data: Partial<AppConfig>): void;
}
//# sourceMappingURL=config.d.ts.map