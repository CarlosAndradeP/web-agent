import { type AgentSecurityPolicySnapshot } from '../../services/security-policy.js';
export declare function createReadFileTool(workspaceDir: string, securityPolicy?: AgentSecurityPolicySnapshot): import("ai").Tool<{
    path: string;
}, {
    content: string;
    path: string;
    error?: undefined;
} | {
    error: any;
    path: string;
    content?: undefined;
}>;
//# sourceMappingURL=read-file.d.ts.map