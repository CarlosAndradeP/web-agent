import type { ApprovalMode } from '../../types/index.js';
export declare function createInvokeSubAgentTool(options: {
    workspaceDir: string;
    apiBaseUrl: string;
    apiKey: string;
    agentType?: string;
    approvalMode: ApprovalMode;
    approvalTools: string[];
}): import("ai").Tool<{
    task: string;
    maxSteps?: number | undefined;
}, {
    success: boolean;
    result: string;
    stepsUsed: number;
    error?: undefined;
} | {
    success: boolean;
    error: any;
    result: string;
    stepsUsed?: undefined;
}>;
//# sourceMappingURL=sub-agent.d.ts.map