import type Database from 'better-sqlite3';
import type { TaskManager } from '../services/task-manager.js';
import type { CreditManager } from '../services/credit-manager.js';
import type { CompactionService } from '../services/compaction-service.js';
export declare function createChatRouter(db: Database.Database, taskManager: TaskManager, creditManager: CreditManager, compactionService: CompactionService): import("express-serve-static-core").Router;
//# sourceMappingURL=chat.d.ts.map