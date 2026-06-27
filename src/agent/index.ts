import { ToolLoopAgent, stepCountIs } from 'ai';
import type { ModelMessage } from '@ai-sdk/provider-utils';
import { createProvider } from './provider.js';
import { buildSystemPrompt } from './instructions.js';
import { buildToolSet } from './tools/index.js';
import { createLogger } from '../services/logger.js';
import type { ApprovalMode, AgentStep } from '../types/index.js';
import type { ApprovalManager } from '../services/approval-manager.js';

const log = createLogger('Agent');

export interface ProjectInfo {
  uuid: string;
  name: string;
  type: 'static' | 'php' | 'node';
  publicUrl: string;
}

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
  projectInfo?: ProjectInfo;
  approvalManager?: ApprovalManager;
  userId?: string;
  conversationContext?: Array<ModelMessage>;
}

export function createAgent(options: CreateAgentOptions) {
  log.info('Creating agent', { model: options.model, maxSteps: options.maxSteps, workspaceDir: options.workspaceDir, agentType: options.agentType });

  const provider = createProvider(options.apiBaseUrl, options.apiKey, options.agentType);
  const tools = buildToolSet({
    workspaceDir: options.workspaceDir,
    approvalMode: options.approvalMode,
    approvalTools: options.approvalTools,
    apiBaseUrl: options.apiBaseUrl,
    apiKey: options.apiKey,
    agentType: options.agentType,
    approvalManager: options.approvalManager,
    userId: options.userId,
  });

  log.info('Provider and tools created', { toolCount: Object.keys(tools).length, toolNames: Object.keys(tools) });

  const isGlmModel = options.model.toLowerCase().includes('glm');
  const maxOutputTokens = isGlmModel ? 16384 : 8192;

  const systemPrompt = buildSystemPrompt(options.projectInfo ?? null);

  const agent = new ToolLoopAgent({
    model: provider.chatModel(options.model) as any,
    instructions: systemPrompt,
    tools,
    stopWhen: stepCountIs(options.maxSteps),
    maxOutputTokens,
  });

  log.info('ToolLoopAgent instance created', { maxOutputTokens, maxSteps: options.maxSteps, hasProjectInfo: !!options.projectInfo });

  return { agent, abortSignal: options.abortSignal };
}
