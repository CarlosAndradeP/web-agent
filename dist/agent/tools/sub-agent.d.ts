import { type AgentSecurityPolicySnapshot } from '../../services/security-policy.js';
export declare function createInvokeSubAgentTool(options: {
    workspaceDir: string;
    apiBaseUrl: string;
    apiKey: string;
    agentType?: string;
    abortSignal?: AbortSignal;
    securityPolicy?: AgentSecurityPolicySnapshot;
}): import("ai").Tool<{
    task: string;
    maxSteps?: number | undefined;
}, {
    success: boolean;
    result: string;
    stepsUsed: number;
    createdFiles: string[];
    error?: undefined;
} | {
    success: boolean;
    error: any;
    result: string;
    stepsUsed?: undefined;
    createdFiles?: undefined;
}>;
//# sourceMappingURL=sub-agent.d.ts.map