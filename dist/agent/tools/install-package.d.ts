import { type AgentSecurityPolicySnapshot } from '../../services/security-policy.js';
export declare function createInstallPackageTool(workspaceDir: string, securityPolicy?: AgentSecurityPolicySnapshot): import("ai").Tool<{
    package: string;
    manager: "npm" | "pip";
}, {
    stdout: any;
    stderr: any;
    exitCode: any;
}>;
//# sourceMappingURL=install-package.d.ts.map