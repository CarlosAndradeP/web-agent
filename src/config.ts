import 'dotenv/config';
import { createLogger } from './services/logger.js';

const log = createLogger('Config');

const isProduction = process.env.NODE_ENV === 'production';

// JWT secrets: separate access/refresh. Either can be set via the legacy
// JWT_SECRET env (applied to both for backward compatibility with existing
// deployments during the transition), or via the explicit ACCESS_TOKEN_SECRET
// / REFRESH_TOKEN_SECRET env vars (recommended). When neither is set, dev mode
// falls back to deterministic insecure defaults with a warning; production
// refuses to boot.
const jwtSecret = process.env.JWT_SECRET;
const accessTokenSecretRaw = process.env.ACCESS_TOKEN_SECRET ?? jwtSecret;
const refreshTokenSecretRaw = process.env.REFRESH_TOKEN_SECRET ?? jwtSecret;

if (!accessTokenSecretRaw || !refreshTokenSecretRaw) {
  if (isProduction) {
    log.error('FATAL: ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET (or legacy JWT_SECRET) are required in production. Set them in .env or docker-compose.yml');
    process.exit(1);
  }
  log.warn('JWT secrets not set — using insecure defaults. DO NOT use in production!');
}

const accessTokenSecret = accessTokenSecretRaw || 'web-agent-access-token-secret-insecure-default-dev-only';
const refreshTokenSecret = refreshTokenSecretRaw || 'web-agent-refresh-token-secret-insecure-default-dev-only';

const onlyofficeJwtSecretRaw = process.env.ONLYOFFICE_JWT_SECRET;
if (!onlyofficeJwtSecretRaw && isProduction) {
  log.error('FATAL: ONLYOFFICE_JWT_SECRET is required in production for the Word workspace. Set it in .env or docker-compose.yml');
  process.exit(1);
}
if (!onlyofficeJwtSecretRaw) {
  log.warn('ONLYOFFICE_JWT_SECRET not set - using an insecure development-only value.');
}

const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  if (isProduction) {
    log.error('FATAL: ADMIN_PASSWORD environment variable is required in production. Set it in .env or docker-compose.yml');
    process.exit(1);
  }
  log.warn('ADMIN_PASSWORD not set — using insecure default "admin123". DO NOT use in production!');
}

const parsedAgentMaxRetries = Number.parseInt(process.env.AGENT_MAX_RETRIES || '5', 10);
const agentMaxRetries = Number.isFinite(parsedAgentMaxRetries)
  ? Math.min(10, Math.max(0, parsedAgentMaxRetries))
  : 5;

export const config = {
  port: parseInt(process.env.PORT || '89', 10),
  // Use the deployment value verbatim. It may be a LAN IP, Docker service
  // name, host.docker.internal, or a public domain.
  apiBaseUrl: process.env.API_BASE_URL || 'http://192.168.3.5:11431/v1',
  apiKey: process.env.API_KEY || '',
  workspaceDir: process.env.WORKSPACE_DIR || './workspace',
  workspaceBaseDir: process.env.WORKSPACE_BASE_DIR || './workspace',
  dataDir: process.env.DATA_DIR || './data',
  projectLinkBaseDir: process.env.PROJECT_LINK_BASE_DIR || './data/project-links',
  maxSteps: parseInt(process.env.MAX_STEPS || '100', 10),
  agentMaxRetries,
  defaultModel: process.env.DEFAULT_MODEL || 'z-ai/glm-5.2',
  agentType: (process.env.AGENT_TYPE || 'none') as 'main' | 'sub' | 'none',
  jwtSecret: accessTokenSecret,
  accessTokenSecret,
  refreshTokenSecret,
  adminPassword: adminPassword || 'admin123',
  initialCredits: parseInt(process.env.INITIAL_CREDITS || '100', 10),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  corsOrigins: process.env.CORS_ORIGINS || '',
  trustProxy: process.env.TRUST_PROXY || '',
  mercadoPagoAccessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || '',
  mercadoPagoPublicKey: process.env.MERCADO_PAGO_PUBLIC_KEY || '',
  mercadoPagoWebhookSecret: process.env.MERCADO_PAGO_WEBHOOK_SECRET || '',
  pixCreditPriceBrl: parseFloat(process.env.PIX_CREDIT_PRICE_BRL || '1'),
  dailyBonusCredits: parseInt(process.env.DAILY_BONUS_CREDITS || '2', 10),
  onlyofficePublicUrl: (process.env.ONLYOFFICE_PUBLIC_URL || 'http://localhost:8082').replace(/\/+$/, ''),
  onlyofficeInternalUrl: (process.env.ONLYOFFICE_INTERNAL_URL || 'http://onlyoffice-documentserver').replace(/\/+$/, ''),
  onlyofficeStorageUrl: (process.env.ONLYOFFICE_STORAGE_URL || 'http://web-agent:89').replace(/\/+$/, ''),
  onlyofficeJwtSecret: onlyofficeJwtSecretRaw || 'onlyoffice-insecure-development-secret',
};
