import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';

export type BenchmarkCategory = 'chat' | 'reasoning' | 'coding';
export type BenchmarkRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ModelBenchmarkResult {
  id: string;
  runId: string;
  modelId: string;
  category: BenchmarkCategory;
  attempt: number;
  success: boolean;
  latencyMs: number | null;
  qualityScore: number;
  outputPreview: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ModelBenchmarkRun {
  id: string;
  status: BenchmarkRunStatus;
  categories: BenchmarkCategory[];
  modelCount: number;
  completedModels: number;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
  results: ModelBenchmarkResult[];
}

export class ModelBenchmarksRepository {
  constructor(private db: Database.Database) {}

  create(modelCount: number, categories: BenchmarkCategory[], createdBy?: string): ModelBenchmarkRun {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO model_benchmark_runs (id, status, categories, model_count, completed_models, created_by, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
    ).run(id, 'pending', JSON.stringify(categories), modelCount, createdBy ?? null, now);
    return this.findById(id)!;
  }

  findById(id: string): ModelBenchmarkRun | undefined {
    const row = this.db.prepare('SELECT * FROM model_benchmark_runs WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return this.mapRun(row, this.listResults(id));
  }

  latest(limit = 10): ModelBenchmarkRun[] {
    const rows = this.db.prepare('SELECT * FROM model_benchmark_runs ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
    return rows.map(row => this.mapRun(row, this.listResults(row.id)));
  }

  setStatus(id: string, status: BenchmarkRunStatus): void {
    const completedAt = status === 'completed' || status === 'failed' ? new Date().toISOString() : null;
    this.db.prepare('UPDATE model_benchmark_runs SET status = ?, completed_at = ? WHERE id = ?').run(status, completedAt, id);
  }

  incrementCompletedModels(id: string): void {
    this.db.prepare('UPDATE model_benchmark_runs SET completed_models = completed_models + 1 WHERE id = ?').run(id);
  }

  addResult(result: Omit<ModelBenchmarkResult, 'id' | 'createdAt'>): void {
    this.db.prepare(`
      INSERT INTO model_benchmark_results
        (id, run_id, model_id, category, attempt, success, latency_ms, quality_score, output_preview, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuid(), result.runId, result.modelId, result.category, result.attempt,
      result.success ? 1 : 0, result.latencyMs, result.qualityScore,
      result.outputPreview, result.errorMessage, new Date().toISOString()
    );
  }

  private listResults(runId: string): ModelBenchmarkResult[] {
    const rows = this.db.prepare('SELECT * FROM model_benchmark_results WHERE run_id = ? ORDER BY model_id, category, attempt').all(runId) as any[];
    return rows.map(row => ({
      id: row.id,
      runId: row.run_id,
      modelId: row.model_id,
      category: row.category,
      attempt: row.attempt,
      success: row.success === 1,
      latencyMs: row.latency_ms,
      qualityScore: row.quality_score,
      outputPreview: row.output_preview,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    }));
  }

  private mapRun(row: any, results: ModelBenchmarkResult[]): ModelBenchmarkRun {
    return {
      id: row.id,
      status: row.status,
      categories: JSON.parse(row.categories),
      modelCount: row.model_count,
      completedModels: row.completed_models,
      createdBy: row.created_by,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      results,
    };
  }
}
