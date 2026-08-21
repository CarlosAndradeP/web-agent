import { type AgentSecurityPolicySnapshot } from '../../services/security-policy.js';
export declare function createRunCommandTool(workspaceDir: string, securityPolicy?: AgentSecurityPolicySnapshot): import("ai").Tool<{
    command: string;
    timeout?: number | undefined;
}, {
    stdout: any;
    stderr: any;
    exitCode: any;
}>;
//# sourceMappingURL=run-command.d.ts.map