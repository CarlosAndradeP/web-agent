import type { AppConfig } from '../types/index.js';
import {
  ModelBenchmarksRepository,
  type BenchmarkCategory,
  type ModelBenchmarkRun,
} from '../db/repositories/model-benchmarks.js';
import { createLogger } from './logger.js';
import { llmRateLimiter } from './llm-rate-limiter.js';

const log = createLogger('ModelBenchmark');
const MAX_CONCURRENCY = 2;
const REQUEST_TIMEOUT_MS = 45_000;

const TESTS: Record<BenchmarkCategory, { prompt: string; evaluate: (output: string) => number }> = {
  chat: {
    prompt: 'Responda somente com a expressão BENCHMARK_OK, sem pontuação, explicação ou formatação.',
    evaluate: output => output.trim() === 'BENCHMARK_OK' ? 100 : output.includes('BENCHMARK_OK') ? 60 : 0,
  },
  reasoning: {
    prompt: 'Um depósito tinha 18 caixas, vendeu 7 e recebeu 3 entregas de 4 caixas cada. Responda somente com o número final.',
    evaluate: output => output.trim().replace(/[^0-9-]/g, '') === '23' ? 100 : 0,
  },
  coding: {
    prompt: 'Escreva uma função JavaScript chamada sumPositive(numbers) que some apenas números positivos em O(n). Retorne somente o código.',
    evaluate: output => {
      const checks = [
        /sumPositive\s*\(/.test(output),
        /(?:for\s*\(|reduce\s*\()/.test(output),
        /(?:>\s*0|Math\.max)/.test(output),
        /return/.test(output),
      ];
      return checks.filter(Boolean).length * 25;
    },
  },
};

export class ModelBenchmarkService {
  constructor(private repo: ModelBenchmarksRepository) {}

  start(modelIds: string[], categories: BenchmarkCategory[], repetitions: number, config: AppConfig, createdBy?: string): ModelBenchmarkRun {
    const run = this.repo.create(modelIds.length, categories, createdBy);
    void this.execute(run.id, modelIds, categories, repetitions, config).catch(err => {
      log.error('Benchmark run failed', { runId: run.id, error: err.message });
      this.repo.setStatus(run.id, 'failed');
    });
    return run;
  }

  private async execute(runId: string, modelIds: string[], categories: BenchmarkCategory[], repetitions: number, config: AppConfig): Promise<void> {
    this.repo.setStatus(runId, 'running');
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < modelIds.length) {
        const modelId = modelIds[nextIndex++];
        for (const category of categories) {
          for (let attempt = 1; attempt <= repetitions; attempt++) {
            await this.testModel(runId, modelId, category, attempt, config);
          }
        }
        this.repo.incrementCompletedModels(runId);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, modelIds.length) }, () => worker()));
    this.repo.setStatus(runId, 'completed');
  }

  private async testModel(runId: string, modelId: string, category: BenchmarkCategory, attempt: number, config: AppConfig): Promise<void> {
    const startedAt = Date.now();
    try {
      await llmRateLimiter.acquire();
      const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          'x-agent-type': config.agentType,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: TESTS[category].prompt }],
          temperature: 0,
          max_tokens: 180,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const latencyMs = Date.now() - startedAt;
      const data = await response.json().catch(() => ({})) as any;
      if (!response.ok) {
        const detail = data?.error?.message || data?.message || `HTTP ${response.status}`;
        throw new Error(detail);
      }
      const rawContent = data?.choices?.[0]?.message?.content;
      const output = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent ?? '');
      if (!output.trim()) throw new Error('A API retornou uma resposta vazia');
      this.repo.addResult({
        runId, modelId, category, attempt, success: true, latencyMs,
        qualityScore: TESTS[category].evaluate(output),
        outputPreview: output.slice(0, 500), errorMessage: null,
      });
    } catch (err: any) {
      this.repo.addResult({
        runId, modelId, category, attempt, success: false,
        latencyMs: Date.now() - startedAt, qualityScore: 0,
        outputPreview: null, errorMessage: String(err?.message || err).slice(0, 500),
      });
    }
  }
}
