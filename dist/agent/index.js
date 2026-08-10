import { ToolLoopAgent, stepCountIs } from 'ai';
import { createProvider } from './provider.js';
import { buildSystemPrompt } from './instructions.js';
import { buildToolSet } from './tools/index.js';
import { createLogger } from '../services/logger.js';
const log = createLogger('Agent');
export function createAgent(options) {
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
        abortSignal: options.abortSignal,
    });
    log.info('Provider and tools created', { toolCount: Object.keys(tools).length, toolNames: Object.keys(tools) });
    const isGlmModel = options.model.toLowerCase().includes('glm');
    const maxOutputTokens = isGlmModel ? 16384 : 8192;
    const systemPrompt = buildSystemPrompt(options.projectInfo ?? null, options.workspaceProfile ?? 'development');
    const agent = new ToolLoopAgent({
        model: provider.chatModel(options.model),
        instructions: systemPrompt,
        tools,
        stopWhen: stepCountIs(options.maxSteps),
        maxOutputTokens,
    });
    log.info('ToolLoopAgent instance created', { maxOutputTokens, maxSteps: options.maxSteps, hasProjectInfo: !!options.projectInfo });
    return { agent, abortSignal: options.abortSignal };
}
//# sourceMappingURL=index.js.map