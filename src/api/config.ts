import { Router } from 'express';
import type { ConfigRepository } from '../db/repositories/config.js';

export function createConfigRouter(configRepo: ConfigRepository) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(configRepo.getAll());
  });

  router.put('/', (req, res) => {
    configRepo.updateAll(req.body);
    res.json(configRepo.getAll());
  });

  return router;
}
