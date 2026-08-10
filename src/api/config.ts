import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ConfigRepository } from '../db/repositories/config.js';
import { resolveModels, invalidateModelCache } from '../services/model-resolver.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('ConfigAPI');

export function createConfigRouter(configRepo: ConfigRepository, adminMiddleware: (req: Request, res: Response, next: NextFunction) => void) {
  const router = Router();

  // GET returns public config (no apiKey) for all authenticated users
  router.get('/', (_req, res) => {
    res.json(configRepo.getPublic());
  });

  // PUT is admin-only — returns full config including apiKey
  router.put('/', adminMiddleware, async (req, res) => {
    const modelToValidate = req.body.defaultModel;
    if (modelToValidate !== undefined) {
      try {
        const apiBaseUrl = req.body.apiBaseUrl ?? configRepo.getAll().apiBaseUrl;
        const availableModels = await resolveModels(apiBaseUrl);
        if (!availableModels.some(m => m.id === modelToValidate)) {
          log.warn('Default model not available, saving anyway', { model: modelToValidate, available: availableModels.map(m => m.id) });
          res.status(400).json({ error: `Model "${modelToValidate}" is not available. Available models: ${availableModels.map(m => m.id).join(', ')}` });
          return;
        }
      } catch (err: any) {
        log.warn('Could not validate model, saving anyway', { error: err.message });
      }
    }

    configRepo.updateAll(req.body);
    // API base URL may have changed; invalidate the model list cache so the
    // next request refetches from the new endpoint.
    invalidateModelCache();
    res.json(configRepo.getAll());
  });

  return router;
}
