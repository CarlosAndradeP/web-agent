import type { ModelInfo } from '../types/index.js';

let cachedModels: ModelInfo[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

export async function resolveModels(apiBaseUrl: string, apiKey: string): Promise<ModelInfo[]> {
  const now = Date.now();
  if (cachedModels && now - cacheTime < CACHE_TTL) {
    return cachedModels;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json() as any;
    const models: ModelInfo[] = (data.data || []).map((m: any) => ({
      id: m.id,
      name: m.id,
      contextLength: m.context_length ?? undefined,
    }));
    cachedModels = models;
    cacheTime = now;
    return models;
  } catch {
    return cachedModels ?? [{ id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B' }];
  }
}
