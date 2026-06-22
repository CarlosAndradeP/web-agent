import { createWriteFileTool } from './write-file.js';
import { createReadFileTool } from './read-file.js';
import { createListFilesTool } from './list-files.js';
import { createDeleteFileTool } from './delete-file.js';
import { createRunCommandTool } from './run-command.js';
import { createExecuteCodeTool } from './execute-code.js';
import { createSearchFilesTool } from './search-files.js';
import { createWebFetchTool } from './web-fetch.js';
import { createInstallPackageTool } from './install-package.js';
import type { ApprovalMode } from '../../types/index.js';
import { createLogger } from '../../services/logger.js';

const log = createLogger('ToolSet');

export function buildToolSet(options: {
  workspaceDir: string;
  approvalMode: ApprovalMode;
  approvalTools: string[];
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

  if (options.approvalMode === 'none') {
    log.info('Approval mode: none — all tools execute immediately');
    return allTools;
  }

  if (options.approvalMode === 'all') {
    for (const key of Object.keys(allTools)) {
      allTools[key] = { ...allTools[key], needsApproval: true };
    }
    log.info('Approval mode: all — all tools require approval');
    return allTools;
  }

  for (const toolName of options.approvalTools) {
    if (allTools[toolName]) {
      allTools[toolName] = { ...allTools[toolName], needsApproval: true };
    }
  }
  log.info('Approval mode: custom', { approvalTools: options.approvalTools });

  return allTools;
}
