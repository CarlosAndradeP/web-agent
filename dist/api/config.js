import { Router } from 'express';
import { resolveModels, invalidateModelCache } from '../services/model-resolver.js';
import { createLogger } from '../services/logger.js';
import { MAX_AGENT_STEPS } from '../lib/agent-limits.js';
const log = createLogger('ConfigAPI');
export function createConfigRouter(configRepo, adminMiddleware) {
    const router = Router();
    // GET returns public config (no apiKey) for all authenticated users
    router.get('/', (_req, res) => {
        res.json(configRepo.getPublic());
    });
    // PUT is admin-only — returns full config including apiKey
    router.put('/', adminMiddleware, async (req, res) => {
        if (req.body?.maxSteps !== undefined && (!Number.isInteger(req.body.maxSteps) || req.body.maxSteps < 1 || req.body.maxSteps > MAX_AGENT_STEPS)) {
            res.status(400).json({ error: `maxSteps must be an integer between 1 and ${MAX_AGENT_STEPS}` });
            return;
        }
        const modelToValidate = req.body.defaultModel;
        if (modelToValidate !== undefined) {
            try {
                const apiBaseUrl = req.body.apiBaseUrl ?? configRepo.getAll().apiBaseUrl;
                const availableModels = await resolveModels(apiBaseUrl, req.body.apiKey || configRepo.getAll().apiKey);
                if (!availableModels.some(m => m.id === modelToValidate)) {
                    log.warn('Default model not available, saving anyway', { model: modelToValidate, available: availableModels.map(m => m.id) });
                    res.status(400).json({ error: `Model "${modelToValidate}" is not available. Available models: ${availableModels.map(m => m.id).join(', ')}` });
                    return;
                }
            }
            catch (err) {
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
//# sourceMappingURL=config.js.map