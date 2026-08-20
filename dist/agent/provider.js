import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createLogger, logApiCall } from '../services/logger.js';
import { llmRateLimiter } from '../services/llm-rate-limiter.js';
const log = createLogger('Provider');
export function createProvider(apiBaseUrl, apiKey, agentType = 'none') {
    log.info('Creating OpenAI-compatible provider', { apiBaseUrl, hasApiKey: !!apiKey, agentType });
    logApiCall('provider', 'request', { method: 'INIT', url: apiBaseUrl });
    try {
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
                await llmRateLimiter.acquire(signal ?? undefined);
                return globalThis.fetch(input, init);
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