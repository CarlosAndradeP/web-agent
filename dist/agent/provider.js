import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createLogger } from '../services/logger.js';
const log = createLogger('Provider');
export function createProvider(apiBaseUrl, apiKey, agentType = 'none') {
    log.info('Creating OpenAI-compatible provider', { apiBaseUrl, hasApiKey: !!apiKey, agentType });
    try {
        const provider = createOpenAICompatible({
            name: 'nvidia-nims',
            baseURL: apiBaseUrl,
            headers: {
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                'x-agent-type': agentType,
            },
        });
        log.info('Provider created successfully');
        return provider;
    }
    catch (err) {
        log.error('Failed to create provider', { apiBaseUrl, error: err.message, stack: err.stack });
        throw err;
    }
}
//# sourceMappingURL=provider.js.map