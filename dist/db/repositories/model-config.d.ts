import type Database from 'better-sqlite3';
export interface ModelConfig {
    id: string;
    modelId: string;
    enabled: boolean;
    costPerStep: number;
    displayName: string | null;
    createdAt: string;
    updatedAt: string;
}
export declare class ModelConfigRepository {
    private db;
    constructor(db: Database.Database);
    findByModelId(modelId: string): ModelConfig | undefined;
    list(): ModelConfig[];
    listEnabled(): ModelConfig[];
    upsert(modelId: string, enabled: boolean, costPerStep: number, displayName?: string | null): ModelConfig;
    setEnabled(modelId: string, enabled: boolean): void;
    batchSetEnabled(modelIds: string[], enabled: boolean): number;
    setCostPerStep(modelId: string, costPerStep: number): void;
    deleteByModelId(modelId: string): void;
    getCostPerStep(modelId: string): number;
    isModelEnabled(modelId: string): boolean;
    private mapRow;
}
//# sourceMappingURL=model-config.d.ts.map