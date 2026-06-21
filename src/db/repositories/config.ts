import type Database from 'better-sqlite3';
import type { ApprovalMode, AppConfig } from '../../types/index.js';
import { config as envConfig } from '../../config.js';

const DEFAULTS: Record<string, string> = {
  default_model: envConfig.defaultModel,
  max_steps: String(envConfig.maxSteps),
  approval_mode: 'custom',
  approval_tools: JSON.stringify(['runCommand', 'deleteFile', 'installPackage', 'executeCode']),
  api_base_url: envConfig.apiBaseUrl,
  api_key: envConfig.apiKey,
  workspace_dir: envConfig.workspaceDir,
};

export class ConfigRepository {
  constructor(private db: Database.Database) {}

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key) as any;
    return row?.value ?? DEFAULTS[key];
  }

  set(key: string, value: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(key, value, now);
  }

  getAll(): AppConfig {
    return {
      defaultModel: this.get('default_model')!,
      maxSteps: parseInt(this.get('max_steps')!, 10),
      approvalMode: (this.get('approval_mode') ?? 'custom') as ApprovalMode,
      approvalTools: JSON.parse(this.get('approval_tools') ?? '[]'),
      apiBaseUrl: this.get('api_base_url')!,
      apiKey: this.get('api_key')!,
      workspaceDir: this.get('workspace_dir')!,
    };
  }

  updateAll(data: Partial<AppConfig>): void {
    if (data.defaultModel !== undefined) this.set('default_model', data.defaultModel);
    if (data.maxSteps !== undefined) this.set('max_steps', String(data.maxSteps));
    if (data.approvalMode !== undefined) this.set('approval_mode', data.approvalMode);
    if (data.approvalTools !== undefined) this.set('approval_tools', JSON.stringify(data.approvalTools));
    if (data.apiBaseUrl !== undefined) this.set('api_base_url', data.apiBaseUrl);
    if (data.apiKey !== undefined) this.set('api_key', data.apiKey);
    if (data.workspaceDir !== undefined) this.set('workspace_dir', data.workspaceDir);
  }
}
