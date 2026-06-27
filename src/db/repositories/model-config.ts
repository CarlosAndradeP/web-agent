import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { createLogger } from '../../services/logger.js';

const log = createLogger('ModelConfigRepository');

export interface ModelConfig {
  id: string;
  modelId: string;
  enabled: boolean;
  costPerStep: number;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export class ModelConfigRepository {
  constructor(private db: Database.Database) {}

  findByModelId(modelId: string): ModelConfig | undefined {
    const row = this.db.prepare('SELECT * FROM model_config WHERE model_id = ?').get(modelId) as any;
    return row ? this.mapRow(row) : undefined;
  }

  list(): ModelConfig[] {
    const rows = this.db.prepare('SELECT * FROM model_config ORDER BY model_id').all() as any[];
    return rows.map(r => this.mapRow(r));
  }

  listEnabled(): ModelConfig[] {
    const rows = this.db.prepare('SELECT * FROM model_config WHERE enabled = 1 ORDER BY model_id').all() as any[];
    return rows.map(r => this.mapRow(r));
  }

  upsert(modelId: string, enabled: boolean, costPerStep: number, displayName?: string | null): ModelConfig {
    const existing = this.findByModelId(modelId);
    const now = new Date().toISOString();

    if (existing) {
      this.db.prepare(
        'UPDATE model_config SET enabled = ?, cost_per_step = ?, display_name = ?, updated_at = ? WHERE model_id = ?'
      ).run(enabled ? 1 : 0, costPerStep, displayName ?? null, now, modelId);
      log.info('Model config updated', { modelId, enabled, costPerStep });
    } else {
      const id = uuid();
      this.db.prepare(
        'INSERT INTO model_config (id, model_id, enabled, cost_per_step, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, modelId, enabled ? 1 : 0, costPerStep, displayName ?? null, now, now);
      log.info('Model config created', { modelId, enabled, costPerStep });
    }

    return this.findByModelId(modelId)!;
  }

  setEnabled(modelId: string, enabled: boolean): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE model_config SET enabled = ?, updated_at = ? WHERE model_id = ?').run(enabled ? 1 : 0, now, modelId);
  }

  batchSetEnabled(modelIds: string[], enabled: boolean): number {
    const now = new Date().toISOString();
    let count = 0;
    const transaction = this.db.transaction(() => {
      for (const id of modelIds) {
        const existing = this.findByModelId(id);
        if (existing) {
          const result = this.db.prepare('UPDATE model_config SET enabled = ?, updated_at = ? WHERE model_id = ?').run(enabled ? 1 : 0, now, id);
          count += result.changes;
        } else {
          this.db.prepare(
            'INSERT INTO model_config (id, model_id, enabled, cost_per_step, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(uuid(), id, enabled ? 1 : 0, 1, null, now, now);
          count += 1;
        }
      }
    });
    transaction();
    log.info('Batch model enabled update', { count, enabled, modelCount: modelIds.length });
    return count;
  }

  setCostPerStep(modelId: string, costPerStep: number): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE model_config SET cost_per_step = ?, updated_at = ? WHERE model_id = ?').run(costPerStep, now, modelId);
  }

  deleteByModelId(modelId: string): void {
    this.db.prepare('DELETE FROM model_config WHERE model_id = ?').run(modelId);
  }

  getCostPerStep(modelId: string): number {
    const row = this.db.prepare('SELECT cost_per_step FROM model_config WHERE model_id = ?').get(modelId) as any;
    return row ? row.cost_per_step : 1;
  }

  isModelEnabled(modelId: string): boolean {
    const row = this.db.prepare('SELECT enabled FROM model_config WHERE model_id = ?').get(modelId) as any;
    if (!row) return true;
    return row.enabled === 1;
  }

  private mapRow(row: any): ModelConfig {
    return {
      id: row.id,
      modelId: row.model_id,
      enabled: row.enabled === 1,
      costPerStep: row.cost_per_step,
      displayName: row.display_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
