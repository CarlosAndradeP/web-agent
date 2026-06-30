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
import { createLogger, logSubAgentEvent } from '../../services/logger.js';
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
            logSubAgentEvent('sub-agent', undefined, 'start', { task });
            log.info('Spawning sub-agent', { task: task.slice(0, 100), maxSteps: cappedSteps });
            const subAbortController = new AbortController();
            const parentSignal = options.abortSignal;
            const onParentAbort = () => { subAbortController.abort(); };
            parentSignal?.addEventListener('abort', onParentAbort, { once: true });
            try {
                const provider = createProvider(options.apiBaseUrl, options.apiKey, options.agentType);
                const subTools = {
                    writeFile: createWriteFileTool(options.workspaceDir),
                    readFile: createReadFileTool(options.workspaceDir),
                    listFiles: createListFilesTool(options.workspaceDir),
                    searchFiles: createSearchFilesTool(options.workspaceDir),
                    runCommand: createRunCommandTool(options.workspaceDir),
                };
                const model = provider.chatModel('z-ai/glm-5.1');
                const subAgent = new ToolLoopAgent({
                    model,
                    instructions: SUB_AGENT_SYSTEM_PROMPT,
                    tools: subTools,
                    stopWhen: stepCountIs(cappedSteps),
                    maxOutputTokens: 8192,
                });
                const result = await subAgent.generate({
                    prompt: task,
                    abortSignal: subAbortController.signal,
                    timeout: { totalMs: 300_000, stepMs: 120_000 },
                });
                const text = result.text ?? 'Sub-agent completed with no output';
                const stepsUsed = result.steps?.length ?? 0;
                logSubAgentEvent('sub-agent', undefined, 'success', { result: text, stepsUsed });
                log.info('Sub-agent completed', { task: task.slice(0, 100), resultLength: text.length, stepsUsed });
                return {
                    success: true,
                    result: text.slice(0, 10000),
                    stepsUsed,
                };
            }
            catch (err) {
                const isAborted = subAbortController.signal.aborted;
                const errorMsg = isAborted ? 'Parent task was cancelled' : err.message;
                if (isAborted) {
                    logSubAgentEvent('sub-agent', undefined, 'aborted', { error: errorMsg });
                }
                else {
                    logSubAgentEvent('sub-agent', undefined, 'error', { error: errorMsg });
                }
                log.error('Sub-agent failed', { task: task.slice(0, 100), error: errorMsg, isAborted });
                return {
                    success: false,
                    error: errorMsg,
                    result: '',
                };
            }
            finally {
                parentSignal?.removeEventListener('abort', onParentAbort);
            }
        },
    });
}
//# sourceMappingURL=sub-agent.js.map