import { resolve } from 'node:path';
import { assertPathInsideWorkspace } from './sanitize.js';

const BLOCKED_PATTERNS = [
  /rm\s+(-rf?|-fr?|--recursive).*\s+\//,
  />\s*\/(dev|etc|proc|sys|app\/data)/,
  /\bcat\s+.*\.(env|key|pem)\b/,
  /\bcurl\b.*\$(cat|echo|printenv)/,
  /\bwget\b.*\$(cat|echo|printenv)/,
  /\b(curl|wget)\b.*\b(localhost|127\.|0\.0\.0\.0|::1|host\.docker\.internal|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i,
  /\b(node|python3?|py|php|ruby|perl)\b\s+(--eval|-e|-c|-r|--input-type)\b/i,
  /\b(npx|pnpm|yarn)\b\s+(tsx|ts-node|node)\b.*\s+(--eval|-e|-c|--input-type)\b/i,
  /\beval\b/,
  /\$\s*\(/,
  /\bprintenv\b|\benv\b(?=\s*$|\s*[;&|])/,
  /\b(sudo|su|doas|pkexec)\b/,
  /\b(chmod|chown)\b.*\s+\//,
  /\bmkfifo\b/,
  /\bnc\b.*(-e|-c)\s+/,
  /\/app\/(data|server\.ts|config\.ts|\.env)/,
  /\bnode\b.*\/app\/(src|dist)\//,
  /\bsqlite3?\b\s+\/app\/data/,
];

export function validateCommand(command: string, workspaceDir?: string): { allowed: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { allowed: false, reason: `Command blocked by security policy` };
    }
  }
  if (workspaceDir) {
    const workspaceCheck = validateWorkspaceCommandAccess(command, workspaceDir);
    if (!workspaceCheck.allowed) return workspaceCheck;
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

export function buildWorkspaceEnv(workspaceDir: string, additionalEnv: Record<string, string> = {}): Record<string, string> {
  return buildSafeEnv({
    HOME: workspaceDir,
    INIT_CWD: workspaceDir,
    PWD: workspaceDir,
    npm_config_cache: resolve(workspaceDir, '.npm-cache'),
    NPM_CONFIG_CACHE: resolve(workspaceDir, '.npm-cache'),
    PIP_CACHE_DIR: resolve(workspaceDir, '.pip-cache'),
    ...additionalEnv,
  });
}

export function getUnprivilegedExecOptions(): { uid?: number; gid?: number } {
  if (process.platform === 'win32') return {};
  const uid = parseIntegerEnv('AGENT_COMMAND_UID');
  const gid = parseIntegerEnv('AGENT_COMMAND_GID');
  if (uid === undefined && gid === undefined && typeof process.getuid === 'function' && process.getuid() === 0) {
    return { uid: 33, gid: 33 };
  }
  return { uid, gid };
}

function validateWorkspaceCommandAccess(command: string, workspaceDir: string): { allowed: boolean; reason?: string } {
  const tokens = tokenizeShellLike(command);
  for (const token of tokens) {
    if (!token || isLikelyUrl(token)) continue;
    if (/(^|[\\/])\.\.([\\/]|$)/.test(token)) {
      return { allowed: false, reason: 'Command blocked: path traversal is not allowed' };
    }

    const paths = extractPathCandidates(token);
    for (const path of paths) {
      try {
        assertPathInsideWorkspace(workspaceDir, path, path);
      } catch {
        return { allowed: false, reason: `Command blocked: path outside workspace is not allowed (${path})` };
      }
    }
  }
  return { allowed: true };
}

function tokenizeShellLike(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      current += char;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s|[;&|<>`]/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function extractPathCandidates(token: string): string[] {
  const candidates: string[] = [];
  const pattern = /(^|[=:'"(])((?:\/(?!\/)|[A-Za-z]:[\\/])[^=:'"()\s;&|<>`$]*)/g;
  for (const match of token.matchAll(pattern)) {
    const candidate = match[2];
    if (candidate && !candidate.startsWith('//')) candidates.push(candidate);
  }
  return candidates;
}

function isLikelyUrl(token: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(token);
}

function parseIntegerEnv(key: string): number | undefined {
  const raw = process.env[key];
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}
