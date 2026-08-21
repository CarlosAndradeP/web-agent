/**
 * Central model identifiers used by the agent runtime.
 * Keep provider-facing slugs here so retired models can be migrated safely.
 */
export const KIMI_K3_MODEL = 'moonshotai/kimi-k3';
export const AGENT_FALLBACK_MODEL = 'openai/gpt-oss-120b';

export function isKimiK3Model(model: string | null | undefined): boolean {
  const normalized = model?.trim().toLowerCase();
  return normalized === 'kimi-k3' || normalized === KIMI_K3_MODEL;
}
