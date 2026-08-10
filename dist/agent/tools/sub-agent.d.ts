export declare function createInvokeSubAgentTool(options: {
    workspaceDir: string;
    apiBaseUrl: string;
    apiKey: string;
    agentType?: string;
    abortSignal?: AbortSignal;
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