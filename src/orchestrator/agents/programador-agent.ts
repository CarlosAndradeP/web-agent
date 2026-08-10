import { ToolLoopAgent, stepCountIs } from 'ai';
import { createProvider } from '../../agent/provider.js';
import { createWriteFileTool } from '../../agent/tools/write-file.js';
import { createReadFileTool } from '../../agent/tools/read-file.js';
import { createListFilesTool } from '../../agent/tools/list-files.js';
import { createDeleteFileTool } from '../../agent/tools/delete-file.js';
import { createSearchFilesTool } from '../../agent/tools/search-files.js';
import { createRunCommandTool } from '../../agent/tools/run-command.js';
import { createExecuteCodeTool } from '../../agent/tools/execute-code.js';
import { createInstallPackageTool } from '../../agent/tools/install-package.js';
import { buildProgramadorPrompt } from '../prompts/programador-prompt.js';

const DEFAULT_MODEL = 'deepseek-ai/deepseek-v4-pro';

export function createProgramadorAgent(workspaceDir: string, apiBaseUrl: string, apiKey: string, projectType?: string, objective?: string, modelOverride?: string) {
  const provider = createProvider(apiBaseUrl, apiKey, 'sub');
  const modelId = modelOverride ?? DEFAULT_MODEL;

  const tools: Record<string, any> = {
    writeFile: createWriteFileTool(workspaceDir),
    readFile: createReadFileTool(workspaceDir),
    listFiles: createListFilesTool(workspaceDir),
    deleteFile: createDeleteFileTool(workspaceDir),
    searchFiles: createSearchFilesTool(workspaceDir),
    runCommand: createRunCommandTool(workspaceDir),
    executeCode: createExecuteCodeTool(workspaceDir),
    installPackage: createInstallPackageTool(workspaceDir),
  };

  const agent = new ToolLoopAgent({
    model: provider.chatModel(modelId) as any,
    instructions: buildProgramadorPrompt(projectType, objective),
    tools,
    stopWhen: stepCountIs(40),
    maxOutputTokens: 16384,
  });

  return agent;
}

export const PROGRAMADOR_DEFAULT_MODEL = DEFAULT_MODEL;
