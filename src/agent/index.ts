import { ToolLoopAgent, stepCountIs } from 'ai';
import { createProvider } from './provider.js';
import { AUTOCORRECTIVE_SYSTEM_PROMPT } from './instructions.js';
import { buildToolSet } from './tools/index.js';
import { createLogger } from '../services/logger.js';
import type { ApprovalMode, AgentStep } from '../types/index.js';

const log = createLogger('Agent');

export interface CreateAgentOptions {
  model: string;
  maxSteps: number;
  sessionId: string;
  workspaceDir: string;
  approvalMode: ApprovalMode;
  approvalTools: string[];
  apiBaseUrl: string;
  apiKey: string;
  agentType?: string;
  abortSignal?: AbortSignal;
  onStep?: (step: AgentStep) => void;
}

export function createAgent(options: CreateAgentOptions) {
  log.info('Creating agent', { model: options.model, maxSteps: options.maxSteps, workspaceDir: options.workspaceDir, agentType: options.agentType });

  const provider = createProvider(options.apiBaseUrl, options.apiKey, options.agentType);
  const tools = buildToolSet({
    workspaceDir: options.workspaceDir,
    approvalMode: options.approvalMode,
    approvalTools: options.approvalTools,
  });

  log.info('Provider and tools created', { toolCount: Object.keys(tools).length, toolNames: Object.keys(tools) });

  const isGlmModel = options.model.toLowerCase().includes('glm');
  const maxOutputTokens = isGlmModel ? 16384 : 8192;

  const agent = new ToolLoopAgent({
    model: provider.chatModel(options.model) as any,
    instructions: AUTOCORRECTIVE_SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(options.maxSteps),
    maxOutputTokens,
  });

  log.info('ToolLoopAgent instance created', { maxOutputTokens, maxSteps: options.maxSteps });

  return { agent, abortSignal: options.abortSignal };
}
