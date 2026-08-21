import { ToolLoopAgent, stepCountIs } from 'ai';
import { createProvider } from '../../agent/provider.js';
import { createReadFileTool } from '../../agent/tools/read-file.js';
import { createListFilesTool } from '../../agent/tools/list-files.js';
import { createSearchFilesTool } from '../../agent/tools/search-files.js';
import { createRunCommandTool } from '../../agent/tools/run-command.js';
import { buildRevisorPrompt } from '../prompts/revisor-prompt.js';
import { applyAgentSecurityPrompt, PROTECTED_AGENT_SECURITY_POLICY, type AgentSecurityPolicySnapshot } from '../../services/security-policy.js';
import { KIMI_K3_MODEL } from '../../agent/models.js';

const DEFAULT_MODEL = KIMI_K3_MODEL;

export function createRevisorAgent(workspaceDir: string, apiBaseUrl: string, apiKey: string, projectType?: string, objective?: string, modelOverride?: string, securityPolicy: AgentSecurityPolicySnapshot = PROTECTED_AGENT_SECURITY_POLICY) {
  const provider = createProvider(apiBaseUrl, apiKey, 'sub');
  const modelId = modelOverride ?? DEFAULT_MODEL;

  const tools: Record<string, any> = {
    readFile: createReadFileTool(workspaceDir, securityPolicy),
    listFiles: createListFilesTool(workspaceDir),
    searchFiles: createSearchFilesTool(workspaceDir),
    runCommand: createRunCommandTool(workspaceDir, securityPolicy),
  };

  const agent = new ToolLoopAgent({
    model: provider.chatModel(modelId) as any,
    instructions: applyAgentSecurityPrompt(buildRevisorPrompt(projectType, objective), securityPolicy),
    tools,
    stopWhen: stepCountIs(10),
    maxOutputTokens: 16384,
  });

  return agent;
}

export const REVISOR_DEFAULT_MODEL = DEFAULT_MODEL;
