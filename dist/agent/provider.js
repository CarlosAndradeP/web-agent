import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createLogger, logApiCall } from '../services/logger.js';
import { llmRateLimiter } from '../services/llm-rate-limiter.js';
import { setTimeout as delay } from 'node:timers/promises';
const log = createLogger('Provider');
export function createProvider(apiBaseUrl, apiKey, agentType = 'none') {
    log.info('Creating OpenAI-compatible provider', { apiBaseUrl, hasApiKey: !!apiKey, agentType });
    logApiCall('provider', 'request', { method: 'INIT', url: apiBaseUrl });
    try {
        let retryAt = 0;
        const provider = createOpenAICompatible({
            name: 'nvidia-nims',
            baseURL: apiBaseUrl,
            headers: {
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                'x-agent-type': agentType,
            },
            // Every actual HTTP attempt (including AI SDK retries) passes through the
            // same process-wide FIFO queue.
            fetch: async (input, init) => {
                const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
                // The SDK ignores Retry-After values >= 60s, while our proxy's default
                // cooldown is 65s. Keep retries of this provider behind that deadline.
                while (retryAt > Date.now()) {
                    await delay(Math.min(retryAt - Date.now(), 60_000), undefined, { signal: signal ?? undefined });
                }
                await llmRateLimiter.acquire(signal ?? undefined);
                const response = await globalThis.fetch(input, init);
                if (response.status === 429) {
                    const value = response.headers.get('retry-after');
                    const seconds = value ? Number(value) : NaN;
                    const waitMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value ?? '') - Date.now();
                    if (Number.isFinite(waitMs) && waitMs > 0)
                        retryAt = Math.max(retryAt, Date.now() + waitMs);
                }
                return response;
            },
        });
        log.info('Provider created successfully');
        return provider;
    }
    catch (err) {
        logApiCall('provider', 'error', { method: 'INIT', url: apiBaseUrl, error: err.message });
        log.error('Failed to create provider', { apiBaseUrl, error: err.message, stack: err.stack });
        throw err;
    }
}
//# sourceMappingURL=provider.js.map