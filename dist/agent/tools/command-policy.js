const BLOCKED_PATTERNS = [
    /rm\s+(-rf?|-fr?|--recursive).*\s+\//,
    />\s*\/(dev|etc|proc|sys|app\/data)/,
    /cat\s+.*\.(env|key|pem)/,
    /curl\s+.*\$(cat|echo|printenv)/,
    /wget\s+.*\$(cat|echo|printenv)/,
    /printenv|env(?=\s*$|\s*[;&|])/,
    /(chmod|chown)\s+.*\s+\//,
    /mkfifo/,
    /nc\s+.*(-e|-c)\s+/,
    /\/app\/(data|server\.ts|config\.ts|\.env)/,
    /node\s+.*\/app\/(src|dist)\//,
    /sqlite3?\s+\/app\/data/,
];
export function validateCommand(command) {
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
export function buildSafeEnv(additionalEnv = {}) {
    const env = {};
    for (const key of SAFE_ENV_KEYS) {
        if (process.env[key])
            env[key] = process.env[key];
    }
    return { ...env, ...additionalEnv };
}
//# sourceMappingURL=command-policy.js.map