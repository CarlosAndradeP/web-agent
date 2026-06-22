import 'dotenv/config';
import { existsSync } from 'node:fs';

const IS_DOCKER = process.env.DOCKER_CONTAINER === '1' || existsSync('/.dockerenv');

function rewriteUrlForDocker(url: string): string {
  if (!IS_DOCKER) return url;
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname === 'host.docker.internal' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname.endsWith('.internal') ||
      parsed.hostname.endsWith('.docker')
    ) {
      return url;
    }
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname);
    const isLikelyDockerService = !isIp && !parsed.hostname.includes('.');
    if (isLikelyDockerService) {
      return url;
    }
    parsed.hostname = 'host.docker.internal';
    return parsed.toString();
  } catch {
    return url;
  }
}

export const config = {
  port: parseInt(process.env.PORT || '89', 10),
  apiBaseUrl: rewriteUrlForDocker(process.env.API_BASE_URL || 'http://192.168.3.5:11431/v1'),
  apiKey: process.env.API_KEY || '',
  workspaceDir: process.env.WORKSPACE_DIR || './workspace',
  dataDir: process.env.DATA_DIR || './data',
  maxSteps: parseInt(process.env.MAX_STEPS || '100', 10),
  defaultModel: process.env.DEFAULT_MODEL || 'z-ai/glm-5.1',
  agentType: (process.env.AGENT_TYPE || 'none') as 'main' | 'sub' | 'none',
};

export { rewriteUrlForDocker, IS_DOCKER };
