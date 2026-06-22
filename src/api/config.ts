import { Router } from 'express';
import type { ConfigRepository } from '../db/repositories/config.js';
import { resolveModels } from '../services/model-resolver.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('ConfigAPI');

export function createConfigRouter(configRepo: ConfigRepository) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(configRepo.getAll());
  });

  router.put('/', async (req, res) => {
    const modelToValidate = req.body.defaultModel;
    if (modelToValidate !== undefined) {
      try {
        const apiBaseUrl = req.body.apiBaseUrl ?? configRepo.getAll().apiBaseUrl;
        const availableModels = await resolveModels(apiBaseUrl);
        if (!availableModels.find(m => m.id === modelToValidate)) {
          log.warn('Default model not available, saving anyway', { model: modelToValidate, available: availableModels.map(m => m.id) });
          res.status(400).json({ error: `Model "${modelToValidate}" is not available. Available models: ${availableModels.map(m => m.id).join(', ')}` });
          return;
        }
      } catch (err: any) {
        log.warn('Could not validate model, saving anyway', { error: err.message });
      }
    }

    configRepo.updateAll(req.body);
    res.json(configRepo.getAll());
  });

  return router;
}
