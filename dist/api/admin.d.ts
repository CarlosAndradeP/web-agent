import type Database from 'better-sqlite3';
import { UsersRepository } from '../db/repositories/users.js';
import { CreditsRepository } from '../db/repositories/credits.js';
import { ProjectRouter } from '../services/project-router.js';
export declare function createAdminRouter(db: Database.Database, usersRepo: UsersRepository, creditsRepo: CreditsRepository, projectRouter: ProjectRouter): import("express-serve-static-core").Router;
//# sourceMappingURL=admin.d.ts.map