import type { ModelInfo } from '../types/index.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('ModelResolver');

interface ModelCacheEntry {
  models: ModelInfo[] | null;
  expiresAt: number;
  pending?: Promise<ModelInfo[]>;
}
const modelCache = new Map<string, ModelCacheEntry>();
const CACHE_TTL = 5 * 60 * 1000;
const FAILURE_CACHE_TTL = 30_000;
const MAX_CACHE_ENTRIES = 16;

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
      if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(new Error(`Models API returned HTTP ${response.status}`), {
          retryable: response.status === 429 || response.status >= 500,
        });
      }
      return response;
    } catch (err: any) {
      lastErr = err;
      if (err.retryable === false) throw err;
      if (i < retries - 1) {
        log.info('Retrying model fetch', { attempt: i + 1, delay });
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export function invalidateModelCache(): void {
  modelCache.clear();
  log.debug('Model cache invalidated');
}

export async function resolveModels(apiBaseUrl: string, apiKey = ''): Promise<ModelInfo[]> {
  const now = Date.now();
  const baseUrl = apiBaseUrl.replace(/\/+$/, '');
  const key = `${baseUrl}\n${apiKey}`;
  let entry = modelCache.get(key);
  if (entry?.pending) return entry.pending;
  if (entry?.models && now < entry.expiresAt) return entry.models;
  if (!entry) {
    if (modelCache.size >= MAX_CACHE_ENTRIES) modelCache.delete(modelCache.keys().next().value!);
    entry = { models: null, expiresAt: 0 };
    modelCache.set(key, entry);
  }
  const currentEntry = entry;
  // One upstream request per endpoint/credential pair; invalidation detaches
  // old entries, so an older response cannot repopulate the current cache.
  const pending = fetchModels(baseUrl, apiKey, currentEntry);
  currentEntry.pending = pending;
  try { return await pending; }
  finally { currentEntry.pending = undefined; }
}

async function fetchModels(apiBaseUrl: string, apiKey: string, entry: ModelCacheEntry): Promise<ModelInfo[]> {
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
    entry.models = models;
    entry.expiresAt = Date.now() + CACHE_TTL;
    log.info('Models fetched successfully', { count: models.length });
    return models;
  } catch (err: any) {
    log.warn('Failed to fetch models, using fallback', { error: err.message });
    entry.models ??= FALLBACK_MODELS;
    entry.expiresAt = Date.now() + FAILURE_CACHE_TTL;
    return entry.models;
  }
}
