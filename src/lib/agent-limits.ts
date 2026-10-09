export const MAX_AGENT_STEPS = 500;

/** Keep legacy database/environment settings usable without weakening requests. */
export function normalizeConfiguredSteps(value: unknown): number {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(parsed)) return 100;
  return Math.min(MAX_AGENT_STEPS, Math.max(1, parsed));
}
