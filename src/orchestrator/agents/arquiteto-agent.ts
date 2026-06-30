import { ToolLoopAgent, stepCountIs } from 'ai';
import { createProvider } from '../../agent/provider.js';
import { createReadFileTool } from '../../agent/tools/read-file.js';
import { createListFilesTool } from '../../agent/tools/list-files.js';
import { createSearchFilesTool } from '../../agent/tools/search-files.js';
import { buildArquitetoPrompt } from '../prompts/arquiteto-prompt.js';

const DEFAULT_MODEL = 'z-ai/glm-5.1';

export function createArquitetoAgent(workspaceDir: string, apiBaseUrl: string, apiKey: string, projectType?: string, objective?: string, modelOverride?: string) {
  const provider = createProvider(apiBaseUrl, apiKey, 'sub');
  const modelId = modelOverride ?? DEFAULT_MODEL;

  const tools: Record<string, any> = {
    readFile: createReadFileTool(workspaceDir),
    listFiles: createListFilesTool(workspaceDir),
    searchFiles: createSearchFilesTool(workspaceDir),
  };

  const agent = new ToolLoopAgent({
    model: provider.chatModel(modelId) as any,
    instructions: buildArquitetoPrompt(projectType, objective),
    tools,
    stopWhen: stepCountIs(15),
    maxOutputTokens: 16384,
  });

  return agent;
}

export const ARQUITETO_DEFAULT_MODEL = DEFAULT_MODEL;
