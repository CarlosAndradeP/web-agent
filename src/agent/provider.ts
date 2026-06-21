import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export function createProvider(apiBaseUrl: string, apiKey: string) {
  return createOpenAICompatible({
    name: 'nvidia-nims',
    baseURL: apiBaseUrl,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
}
