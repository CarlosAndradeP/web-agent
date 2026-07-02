import type Database from 'better-sqlite3';
import type { ApprovalMode, AppConfig, AppConfigPublic } from '../../types/index.js';
import { config as envConfig, rewriteUrlForDocker } from '../../config.js';

const DEFAULTS: Record<string, string> = {
  default_model: envConfig.defaultModel,
  max_steps: String(envConfig.maxSteps),
  approval_mode: 'none',
  approval_tools: JSON.stringify(['runCommand', 'deleteFile', 'installPackage', 'executeCode']),
  api_base_url: envConfig.apiBaseUrl,
  api_key: envConfig.apiKey,
  workspace_dir: envConfig.workspaceDir,
  agent_type: envConfig.agentType,
  registration_enabled: 'true',
};

const LEGACY_MODEL_MAP: Record<string, string> = {
  'meta/llama-3.1-405b-instruct': 'z-ai/glm-5.2',
};

export class ConfigRepository {
  constructor(private db: Database.Database) {}

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key) as any;
    let value = row?.value ?? DEFAULTS[key];
    if (key === 'default_model' && value && LEGACY_MODEL_MAP[value]) {
      value = LEGACY_MODEL_MAP[value];
      this.set(key, value);
    }
    if (key === 'api_base_url' && value) {
      value = rewriteUrlForDocker(value);
    }
    return value;
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
      agentType: this.get('agent_type') ?? 'none',
      registrationEnabled: this.get('registration_enabled') ?? 'true',
    };
  }

  /** Returns config without sensitive fields (apiKey) — safe for non-admin users */
  getPublic(): AppConfigPublic {
    const all = this.getAll();
    const { apiKey, ...rest } = all;
    return { ...rest, apiKeyConfigured: !!apiKey };
  }

  updateAll(data: Partial<AppConfig>): void {
    if (data.defaultModel !== undefined) this.set('default_model', data.defaultModel);
    if (data.maxSteps !== undefined) this.set('max_steps', String(data.maxSteps));
    if (data.approvalMode !== undefined) this.set('approval_mode', data.approvalMode);
    if (data.approvalTools !== undefined) this.set('approval_tools', JSON.stringify(data.approvalTools));
    if (data.apiBaseUrl !== undefined) this.set('api_base_url', data.apiBaseUrl);
    if (data.apiKey !== undefined && data.apiKey !== '') this.set('api_key', data.apiKey);
    if (data.workspaceDir !== undefined) this.set('workspace_dir', data.workspaceDir);
    if (data.agentType !== undefined) this.set('agent_type', data.agentType);
  }
}
