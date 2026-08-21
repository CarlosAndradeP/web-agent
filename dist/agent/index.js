import { ToolLoopAgent, stepCountIs } from 'ai';
import { createProvider } from './provider.js';
import { buildSystemPrompt } from './instructions.js';
import { buildToolSet } from './tools/index.js';
import { createLogger } from '../services/logger.js';
import { config } from '../config.js';
import { applyAgentSecurityPrompt, PROTECTED_AGENT_SECURITY_POLICY } from '../services/security-policy.js';
const log = createLogger('Agent');
export function createAgent(options) {
    const securityPolicy = options.securityPolicy ?? PROTECTED_AGENT_SECURITY_POLICY;
    log.info('Creating agent', { model: options.model, maxSteps: options.maxSteps, workspaceDir: options.workspaceDir, agentType: options.agentType, securityMode: securityPolicy.mode });
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
        workspaceProfile: options.workspaceProfile ?? 'development',
        securityPolicy,
    });
    log.info('Provider and tools created', { toolCount: Object.keys(tools).length, toolNames: Object.keys(tools) });
    const isGlmModel = options.model.toLowerCase().includes('glm');
    const maxOutputTokens = isGlmModel ? 16384 : 8192;
    const systemPrompt = applyAgentSecurityPrompt(buildSystemPrompt(options.projectInfo ?? null, options.workspaceProfile ?? 'development'), securityPolicy);
    const agent = new ToolLoopAgent({
        model: provider.chatModel(options.model),
        instructions: systemPrompt,
        tools,
        stopWhen: stepCountIs(options.maxSteps),
        maxOutputTokens,
        // The SDK retries the current model call in place, so completed tool steps
        // are not replayed while a rate-limited provider is cooling down.
        maxRetries: options.maxRetries ?? config.agentMaxRetries,
    });
    log.info('ToolLoopAgent instance created', {
        maxOutputTokens,
        maxSteps: options.maxSteps,
        maxRetries: options.maxRetries ?? config.agentMaxRetries,
        hasProjectInfo: !!options.projectInfo,
    });
    return { agent, abortSignal: options.abortSignal };
}
//# sourceMappingURL=index.js.map