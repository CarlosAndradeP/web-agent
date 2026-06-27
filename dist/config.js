import 'dotenv/config';
import { existsSync } from 'node:fs';
import { createLogger } from './services/logger.js';
const log = createLogger('Config');
const IS_DOCKER = process.env.DOCKER_CONTAINER === '1' || existsSync('/.dockerenv');
function rewriteUrlForDocker(url) {
    if (!IS_DOCKER)
        return url;
    try {
        const parsed = new URL(url);
        if (parsed.hostname === 'host.docker.internal' ||
            parsed.hostname === 'localhost' ||
            parsed.hostname === '127.0.0.1' ||
            parsed.hostname.endsWith('.internal') ||
            parsed.hostname.endsWith('.docker')) {
            return url;
        }
        const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname);
        const isLikelyDockerService = !isIp && !parsed.hostname.includes('.');
        if (isLikelyDockerService) {
            return url;
        }
        parsed.hostname = 'host.docker.internal';
        return parsed.toString();
    }
    catch {
        return url;
    }
}
const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
    if (isProduction) {
        log.error('FATAL: JWT_SECRET environment variable is required in production. Set it in .env or docker-compose.yml');
        process.exit(1);
    }
    log.warn('JWT_SECRET not set — using insecure default. DO NOT use in production!');
}
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
    if (isProduction) {
        log.error('FATAL: ADMIN_PASSWORD environment variable is required in production. Set it in .env or docker-compose.yml');
        process.exit(1);
    }
    log.warn('ADMIN_PASSWORD not set — using insecure default "admin123". DO NOT use in production!');
}
export const config = {
    port: parseInt(process.env.PORT || '89', 10),
    apiBaseUrl: rewriteUrlForDocker(process.env.API_BASE_URL || 'http://192.168.3.5:11431/v1'),
    apiKey: process.env.API_KEY || '',
    workspaceDir: process.env.WORKSPACE_DIR || './workspace',
    workspaceBaseDir: process.env.WORKSPACE_BASE_DIR || './workspace',
    dataDir: process.env.DATA_DIR || './data',
    maxSteps: parseInt(process.env.MAX_STEPS || '100', 10),
    defaultModel: process.env.DEFAULT_MODEL || 'z-ai/glm-5.1',
    agentType: (process.env.AGENT_TYPE || 'none'),
    jwtSecret: jwtSecret || 'web-agent-jwt-secret-insecure-default-dev-only',
    adminPassword: adminPassword || 'admin123',
    initialCredits: parseInt(process.env.INITIAL_CREDITS || '100', 10),
    publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
};
export { rewriteUrlForDocker, IS_DOCKER };
//# sourceMappingURL=config.js.map