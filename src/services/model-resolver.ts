import type { ModelInfo } from '../types/index.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('ModelResolver');

let cachedModels: ModelInfo[] | null = null;
let cacheTime = 0;
let cacheKey = '';
const CACHE_TTL = 5 * 60 * 1000;

const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'moonshotai/kimi-k3', name: 'Moonshot AI Kimi K3' },
  { id: 'openai/gpt-oss-120b', name: 'OpenAI GPT OSS 120B' },
  { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
  { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
  { id: 'deepseek-ai/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { id: 'nvidia/nemotron-3-super-120b-a12b', name: 'Nemotron 3 Super 120B' },
];

async function fetchWithRetry(url: string, apiKey: string, retries = 2, delay = 3000): Promise<Response> {
  let lastErr: Error = new Error('No attempts made');
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
      if (!response.ok) throw new Error(`Models API returned HTTP ${response.status}`);
      return response;
    } catch (err: any) {
      lastErr = err;
      if (i < retries - 1) {
        log.info('Retrying model fetch', { attempt: i + 1, delay });
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export function invalidateModelCache(): void {
  cachedModels = null;
  cacheTime = 0;
  cacheKey = '';
  log.debug('Model cache invalidated');
}

export async function resolveModels(apiBaseUrl: string, apiKey = ''): Promise<ModelInfo[]> {
  const now = Date.now();
  const key = `${apiBaseUrl}\n${apiKey}`;
  if (cachedModels && cacheKey === key && now - cacheTime < CACHE_TTL) {
    log.debug('Returning cached models', { count: cachedModels.length });
    return cachedModels;
  }

  log.info('Fetching models from API', { apiBaseUrl });
  try {
    const response = await fetchWithRetry(`${apiBaseUrl.replace(/\/+$/, '')}/models`, apiKey);
    const data = await response.json() as any;
    if (!Array.isArray(data.data) || !data.data.every((m: any) => typeof m?.id === 'string')) throw new Error('Invalid models API response');
    const models: ModelInfo[] = data.data.map((m: any) => ({
      id: m.id,
      name: m.id,
      contextLength: m.context_length ?? undefined,
    }));
    cachedModels = models;
    cacheTime = now;
    cacheKey = key;
    log.info('Models fetched successfully', { count: models.length });
    return models;
  } catch (err: any) {
    log.warn('Failed to fetch models, using fallback', { error: err.message });
    return cacheKey === key && cachedModels ? cachedModels : FALLBACK_MODELS;
  }
}
