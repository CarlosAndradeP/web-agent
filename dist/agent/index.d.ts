import { ToolLoopAgent } from 'ai';
import type { ModelMessage } from '@ai-sdk/provider-utils';
import type { ApprovalMode, AgentStep } from '../types/index.js';
import type { ApprovalManager } from '../services/approval-manager.js';
import { type AgentSecurityPolicySnapshot } from '../services/security-policy.js';
export interface ProjectInfo {
    uuid: string;
    name: string;
    type: 'static' | 'php' | 'node';
    publicUrl: string;
}
export interface CreateAgentOptions {
    model: string;
    maxSteps: number;
    sessionId: string;
    workspaceDir: string;
    approvalMode: ApprovalMode;
    approvalTools: string[];
    apiBaseUrl: string;
    apiKey: string;
    agentType?: string;
    abortSignal?: AbortSignal;
    onStep?: (step: AgentStep) => void;
    projectInfo?: ProjectInfo;
    approvalManager?: ApprovalManager;
    userId?: string;
    conversationContext?: Array<ModelMessage>;
    workspaceProfile?: 'development' | 'word';
    maxRetries?: number;
    securityPolicy?: AgentSecurityPolicySnapshot;
}
export declare function createAgent(options: CreateAgentOptions): {
    agent: ToolLoopAgent<never, Record<string, any>, never>;
    abortSignal: AbortSignal | undefined;
};
//# sourceMappingURL=index.d.ts.map