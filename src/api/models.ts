import { Router } from 'express';
import { resolveModels } from '../services/model-resolver.js';
import type { ConfigRepository } from '../db/repositories/config.js';

export function createModelsRouter(configRepo: ConfigRepository) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const appConfig = configRepo.getAll();
    const models = await resolveModels(appConfig.apiBaseUrl, appConfig.apiKey);
    res.json({ models });
  });

  return router;
}
