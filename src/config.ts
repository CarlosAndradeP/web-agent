import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '89', 10),
  apiBaseUrl: process.env.API_BASE_URL || 'http://192.168.3.5:11431/v1',
  apiKey: process.env.API_KEY || '',
  workspaceDir: process.env.WORKSPACE_DIR || './workspace',
  dataDir: process.env.DATA_DIR || './data',
  maxSteps: parseInt(process.env.MAX_STEPS || '100', 10),
  defaultModel: process.env.DEFAULT_MODEL || 'meta/llama-3.1-405b-instruct',
};
