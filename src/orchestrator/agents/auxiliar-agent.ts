import { ToolLoopAgent, stepCountIs } from 'ai';
import { createProvider } from '../../agent/provider.js';
import { createReadFileTool } from '../../agent/tools/read-file.js';
import { createListFilesTool } from '../../agent/tools/list-files.js';
import { createSearchFilesTool } from '../../agent/tools/search-files.js';
import { buildAuxiliarPrompt } from '../prompts/auxiliar-prompt.js';

const DEFAULT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';

export function createAuxiliarAgent(workspaceDir: string, apiBaseUrl: string, apiKey: string, projectType?: string, objective?: string, modelOverride?: string) {
  const provider = createProvider(apiBaseUrl, apiKey, 'sub');
  const modelId = modelOverride ?? DEFAULT_MODEL;

  const tools: Record<string, any> = {
    readFile: createReadFileTool(workspaceDir),
    listFiles: createListFilesTool(workspaceDir),
    searchFiles: createSearchFilesTool(workspaceDir),
  };

  const agent = new ToolLoopAgent({
    model: provider.chatModel(modelId) as any,
    instructions: buildAuxiliarPrompt(projectType, objective),
    tools,
    stopWhen: stepCountIs(5),
    maxOutputTokens: 8192,
  });

  return agent;
}

export const AUXILIAR_DEFAULT_MODEL = DEFAULT_MODEL;
