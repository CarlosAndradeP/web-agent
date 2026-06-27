import { type Request, type Response, type NextFunction } from 'express';
import type { ConfigRepository } from '../db/repositories/config.js';
export declare function createConfigRouter(configRepo: ConfigRepository, adminMiddleware: (req: Request, res: Response, next: NextFunction) => void): import("express-serve-static-core").Router;
//# sourceMappingURL=config.d.ts.map