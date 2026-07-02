const BLOCKED_PATTERNS = [
  /rm\s+(-rf?|-fr?|--recursive).*\s+\//,
  />\s*\/(dev|etc|proc|sys|app\/data)/,
  /\bcat\s+.*\.(env|key|pem)\b/,
  /\bcurl\b.*\$(cat|echo|printenv)/,
  /\bwget\b.*\$(cat|echo|printenv)/,
  /\bprintenv\b|\benv\b(?=\s*$|\s*[;&|])/,
  /\b(chmod|chown)\b.*\s+\//,
  /\bmkfifo\b/,
  /\bnc\b.*(-e|-c)\s+/,
  /\/app\/(data|server\.ts|config\.ts|\.env)/,
  /\bnode\b.*\/app\/(src|dist)\//,
  /\bsqlite3?\b\s+\/app\/data/,
];

export function validateCommand(command: string): { allowed: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { allowed: false, reason: `Command blocked by security policy` };
    }
  }
  return { allowed: true };
}

const SAFE_ENV_KEYS = [
  'PATH', 'HOME', 'LANG', 'TERM', 'NODE_ENV', 'PORT', 'BASE_PATH',
  'NPM_CONFIG_CACHE', 'NPM_CONFIG_PREFIX', 'npm_config_user_agent',
  'WORKSPACE_DIR', 'WORKSPACE_BASE_DIR', 'DOCKER_CONTAINER',
];

export function buildSafeEnv(additionalEnv: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return { ...env, ...additionalEnv };
}
