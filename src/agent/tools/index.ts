import { createWriteFileTool } from './write-file.js';
import { createReadFileTool } from './read-file.js';
import { createListFilesTool } from './list-files.js';
import { createDeleteFileTool } from './delete-file.js';
import { createRunCommandTool } from './run-command.js';
import { createExecuteCodeTool } from './execute-code.js';
import { createSearchFilesTool } from './search-files.js';
import { createWebFetchTool } from './web-fetch.js';
import { createInstallPackageTool } from './install-package.js';
import { createInvokeSubAgentTool } from './sub-agent.js';
import type { ApprovalMode } from '../../types/index.js';
import type { ApprovalManager } from '../../services/approval-manager.js';
import { createLogger } from '../../services/logger.js';
import { v4 as uuid } from 'uuid';

const log = createLogger('ToolSet');

function wrapWithApproval(tool: any, toolName: string, approvalManager: ApprovalManager, userId?: string): any {
  const originalExecute = tool.execute;
  if (!originalExecute) return tool;

  return {
    ...tool,
    execute: async (input: any) => {
      const requestId = uuid();
      const approved = await approvalManager.requestApproval(
        {
          id: requestId,
          taskName: 'Agent',
          toolName,
          toolInput: input,
        },
        userId,
      );
      if (!approved) {
        return { error: 'Approval denied by user', blocked: true };
      }
      return originalExecute(input);
    },
  };
}

export function buildToolSet(options: {
  workspaceDir: string;
  approvalMode: ApprovalMode;
  approvalTools: string[];
  apiBaseUrl?: string;
  apiKey?: string;
  agentType?: string;
  approvalManager?: ApprovalManager;
  userId?: string;
}) {
  log.info('Building tool set', { workspaceDir: options.workspaceDir, approvalMode: options.approvalMode });

  const allTools: Record<string, any> = {
    writeFile: createWriteFileTool(options.workspaceDir),
    readFile: createReadFileTool(options.workspaceDir),
    listFiles: createListFilesTool(options.workspaceDir),
    deleteFile: createDeleteFileTool(options.workspaceDir),
    runCommand: createRunCommandTool(options.workspaceDir),
    executeCode: createExecuteCodeTool(options.workspaceDir),
    searchFiles: createSearchFilesTool(options.workspaceDir),
    webFetch: createWebFetchTool(),
    installPackage: createInstallPackageTool(options.workspaceDir),
  };

  if (options.apiBaseUrl && options.apiKey) {
    allTools.invokeSubAgent = createInvokeSubAgentTool({
      workspaceDir: options.workspaceDir,
      apiBaseUrl: options.apiBaseUrl,
      apiKey: options.apiKey,
      agentType: options.agentType,
      approvalMode: options.approvalMode,
      approvalTools: options.approvalTools,
    });
  }

  if (options.approvalMode === 'none' || !options.approvalManager) {
    log.info('Approval mode: none — all tools execute immediately');
    return allTools;
  }

  const approvalManager = options.approvalManager;
  const userId = options.userId;

  if (options.approvalMode === 'all') {
    for (const key of Object.keys(allTools)) {
      allTools[key] = wrapWithApproval(allTools[key], key, approvalManager, userId);
    }
    log.info('Approval mode: all — all tools require approval');
    return allTools;
  }

  for (const toolName of options.approvalTools) {
    if (allTools[toolName]) {
      allTools[toolName] = wrapWithApproval(allTools[toolName], toolName, approvalManager, userId);
    }
  }
  log.info('Approval mode: custom', { approvalTools: options.approvalTools });

  return allTools;
}
