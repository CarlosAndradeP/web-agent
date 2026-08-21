import { type AgentSecurityPolicySnapshot } from '../../services/security-policy.js';
export declare function createExecuteCodeTool(workspaceDir: string, securityPolicy?: AgentSecurityPolicySnapshot): import("ai").Tool<{
    code: string;
    language: "javascript" | "typescript" | "python";
    timeout?: number | undefined;
}, {
    stdout: any;
    stderr: any;
    exitCode: any;
}>;
//# sourceMappingURL=execute-code.d.ts.map