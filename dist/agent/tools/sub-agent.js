import { tool } from 'ai';
import { z } from 'zod';
import { ToolLoopAgent, stepCountIs } from 'ai';
import { createProvider } from '../provider.js';
import { SUB_AGENT_SYSTEM_PROMPT } from '../instructions.js';
import { createWriteFileTool } from './write-file.js';
import { createReadFileTool } from './read-file.js';
import { createListFilesTool } from './list-files.js';
import { createSearchFilesTool } from './search-files.js';
import { createRunCommandTool } from './run-command.js';
import { createLogger } from '../../services/logger.js';
const log = createLogger('SubAgentTool');
export function createInvokeSubAgentTool(options) {
    return tool({
        description: 'Spawn a sub-agent to handle a focused sub-task autonomously. The sub-agent has read/write/search/command tools but with fewer steps. Use this for parallelizable or decomposable work like "refactor all files matching X" or "search the codebase and fix all instances of Y".',
        inputSchema: z.object({
            task: z.string().describe('Clear description of the sub-task for the sub-agent to accomplish'),
            maxSteps: z.number().optional().describe('Maximum steps for the sub-agent (default: 15, max: 30)'),
        }),
        execute: async ({ task, maxSteps: subMaxSteps = 15 }) => {
            const cappedSteps = Math.min(subMaxSteps, 30);
            log.info('Spawning sub-agent', { task: task.slice(0, 100), maxSteps: cappedSteps });
            try {
                const provider = createProvider(options.apiBaseUrl, options.apiKey, options.agentType);
                const subTools = {
                    writeFile: createWriteFileTool(options.workspaceDir),
                    readFile: createReadFileTool(options.workspaceDir),
                    listFiles: createListFilesTool(options.workspaceDir),
                    searchFiles: createSearchFilesTool(options.workspaceDir),
                    runCommand: createRunCommandTool(options.workspaceDir),
                };
                if (options.approvalMode === 'all') {
                    for (const key of Object.keys(subTools)) {
                        subTools[key] = { ...subTools[key], needsApproval: true };
                    }
                }
                else if (options.approvalMode === 'custom') {
                    for (const toolName of options.approvalTools) {
                        if (subTools[toolName]) {
                            subTools[toolName] = { ...subTools[toolName], needsApproval: true };
                        }
                    }
                }
                const model = provider.chatModel('z-ai/glm-5.1');
                const subAgent = new ToolLoopAgent({
                    model,
                    instructions: SUB_AGENT_SYSTEM_PROMPT,
                    tools: subTools,
                    stopWhen: stepCountIs(cappedSteps),
                    maxOutputTokens: 8192,
                });
                const result = await subAgent.generate({ prompt: task });
                const text = result.text ?? 'Sub-agent completed with no output';
                log.info('Sub-agent completed', { task: task.slice(0, 100), resultLength: text.length });
                return {
                    success: true,
                    result: text.slice(0, 10000),
                    stepsUsed: result.steps?.length ?? 0,
                };
            }
            catch (err) {
                log.error('Sub-agent failed', { task: task.slice(0, 100), error: err.message });
                return {
                    success: false,
                    error: err.message,
                    result: '',
                };
            }
        },
    });
}
//# sourceMappingURL=sub-agent.js.map