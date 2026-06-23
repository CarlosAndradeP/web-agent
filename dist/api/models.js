import { Router } from 'express';
import { resolveModels } from '../services/model-resolver.js';
import { ModelConfigRepository } from '../db/repositories/model-config.js';
export function createModelsRouter(db, configRepo) {
    const router = Router();
    const modelConfigRepo = new ModelConfigRepository(db);
    router.get('/', async (_req, res) => {
        const appConfig = configRepo.getAll();
        const models = await resolveModels(appConfig.apiBaseUrl);
        const modelConfigList = modelConfigRepo.list();
        const configMap = new Map(modelConfigList.map(mc => [mc.modelId, mc]));
        const filtered = models.filter(m => {
            const cfg = configMap.get(m.id);
            return !cfg || cfg.enabled;
        });
        const result = filtered.map(m => {
            const cfg = configMap.get(m.id);
            return {
                ...m,
                costPerStep: cfg ? cfg.costPerStep : 1,
                displayName: cfg?.displayName || m.name || m.id,
            };
        });
        res.json({ models: result });
    });
    return router;
}
//# sourceMappingURL=models.js.map