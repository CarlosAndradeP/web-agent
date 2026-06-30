import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createLogger, logApiCall } from '../services/logger.js';

const log = createLogger('Provider');

export function createProvider(apiBaseUrl: string, apiKey: string, agentType: string = 'none') {
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
    });
    log.info('Provider created successfully');
    return provider;
  } catch (err: any) {
    logApiCall('provider', 'error', { method: 'INIT', url: apiBaseUrl, error: err.message });
    log.error('Failed to create provider', { apiBaseUrl, error: err.message, stack: err.stack });
    throw err;
  }
}
