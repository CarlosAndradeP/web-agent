import { ToolLoopAgent, stepCountIs } from 'ai';
import { createProvider } from './provider.js';
import { AUTOCORRECTIVE_SYSTEM_PROMPT } from './instructions.js';
import { buildToolSet } from './tools/index.js';
import type { ApprovalMode, AgentStep } from '../types/index.js';

export interface CreateAgentOptions {
  model: string;
  maxSteps: number;
  sessionId: string;
  workspaceDir: string;
  approvalMode: ApprovalMode;
  approvalTools: string[];
  apiBaseUrl: string;
  apiKey: string;
  onStep?: (step: AgentStep) => void;
}

export function createAgent(options: CreateAgentOptions) {
  const provider = createProvider(options.apiBaseUrl, options.apiKey);
  const tools = buildToolSet({
    workspaceDir: options.workspaceDir,
    approvalMode: options.approvalMode,
    approvalTools: options.approvalTools,
  });

  const agent = new ToolLoopAgent({
    model: provider.chatModel(options.model) as any,
    instructions: AUTOCORRECTIVE_SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(options.maxSteps),
    maxOutputTokens: 4096,
  });

  return agent;
}
