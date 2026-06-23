import { createLogger } from '../services/logger.js';
const log = createLogger('ModelResolver');
let cachedModels = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;
const FALLBACK_MODELS = [
    { id: 'z-ai/glm-5.1', name: 'Z.AI GLM 5.1' },
    { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
    { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
    { id: 'deepseek-ai/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    { id: 'nvidia/nemotron-3-super-120b-a12b', name: 'Nemotron 3 Super 120B' },
];
async function fetchWithRetry(url, retries = 2, delay = 3000) {
    let lastErr = new Error('No attempts made');
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
            return response;
        }
        catch (err) {
            lastErr = err;
            if (i < retries - 1) {
                log.info('Retrying model fetch', { attempt: i + 1, delay });
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastErr;
}
export async function resolveModels(apiBaseUrl, _apiKey) {
    const now = Date.now();
    if (cachedModels && now - cacheTime < CACHE_TTL) {
        log.debug('Returning cached models', { count: cachedModels.length });
        return cachedModels;
    }
    log.info('Fetching models from API', { apiBaseUrl });
    try {
        const response = await fetchWithRetry(`${apiBaseUrl}/models`);
        const data = await response.json();
        const models = (data.data || []).map((m) => ({
            id: m.id,
            name: m.id,
            contextLength: m.context_length ?? undefined,
        }));
        cachedModels = models;
        cacheTime = now;
        log.info('Models fetched successfully', { count: models.length });
        return models;
    }
    catch (err) {
        log.warn('Failed to fetch models, using fallback', { error: err.message });
        return cachedModels ?? FALLBACK_MODELS;
    }
}
//# sourceMappingURL=model-resolver.js.map