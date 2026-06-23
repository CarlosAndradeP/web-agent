import { v4 as uuid } from 'uuid';
import { createLogger } from '../../services/logger.js';
const log = createLogger('ModelConfigRepository');
export class ModelConfigRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    findByModelId(modelId) {
        const row = this.db.prepare('SELECT * FROM model_config WHERE model_id = ?').get(modelId);
        return row ? this.mapRow(row) : undefined;
    }
    list() {
        const rows = this.db.prepare('SELECT * FROM model_config ORDER BY model_id').all();
        return rows.map(r => this.mapRow(r));
    }
    listEnabled() {
        const rows = this.db.prepare('SELECT * FROM model_config WHERE enabled = 1 ORDER BY model_id').all();
        return rows.map(r => this.mapRow(r));
    }
    upsert(modelId, enabled, costPerStep, displayName) {
        const existing = this.findByModelId(modelId);
        const now = new Date().toISOString();
        if (existing) {
            this.db.prepare('UPDATE model_config SET enabled = ?, cost_per_step = ?, display_name = ?, updated_at = ? WHERE model_id = ?').run(enabled ? 1 : 0, costPerStep, displayName ?? null, now, modelId);
            log.info('Model config updated', { modelId, enabled, costPerStep });
        }
        else {
            const id = uuid();
            this.db.prepare('INSERT INTO model_config (id, model_id, enabled, cost_per_step, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, modelId, enabled ? 1 : 0, costPerStep, displayName ?? null, now, now);
            log.info('Model config created', { modelId, enabled, costPerStep });
        }
        return this.findByModelId(modelId);
    }
    setEnabled(modelId, enabled) {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE model_config SET enabled = ?, updated_at = ? WHERE model_id = ?').run(enabled ? 1 : 0, now, modelId);
    }
    batchSetEnabled(modelIds, enabled) {
        const now = new Date().toISOString();
        const stmt = this.db.prepare('UPDATE model_config SET enabled = ?, updated_at = ? WHERE model_id = ?');
        let count = 0;
        const transaction = this.db.transaction(() => {
            for (const id of modelIds) {
                const result = stmt.run(enabled ? 1 : 0, now, id);
                count += result.changes;
            }
        });
        transaction();
        log.info('Batch model enabled update', { count, enabled, modelCount: modelIds.length });
        return count;
    }
    setCostPerStep(modelId, costPerStep) {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE model_config SET cost_per_step = ?, updated_at = ? WHERE model_id = ?').run(costPerStep, now, modelId);
    }
    deleteByModelId(modelId) {
        this.db.prepare('DELETE FROM model_config WHERE model_id = ?').run(modelId);
    }
    getCostPerStep(modelId) {
        const row = this.db.prepare('SELECT cost_per_step FROM model_config WHERE model_id = ?').get(modelId);
        return row ? row.cost_per_step : 1;
    }
    isModelEnabled(modelId) {
        const row = this.db.prepare('SELECT enabled FROM model_config WHERE model_id = ?').get(modelId);
        if (!row)
            return true;
        return row.enabled === 1;
    }
    mapRow(row) {
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
//# sourceMappingURL=model-config.js.map