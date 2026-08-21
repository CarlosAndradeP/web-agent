import type { ApprovalMode } from '../../types/index.js';
import type { ApprovalManager } from '../../services/approval-manager.js';
import type { WorkspaceProfile } from '../instructions.js';
import { type AgentSecurityPolicySnapshot } from '../../services/security-policy.js';
export declare function buildToolSet(options: {
    workspaceDir: string;
    approvalMode: ApprovalMode;
    approvalTools: string[];
    apiBaseUrl?: string;
    apiKey?: string;
    agentType?: string;
    approvalManager?: ApprovalManager;
    userId?: string;
    abortSignal?: AbortSignal;
    workspaceProfile?: WorkspaceProfile;
    securityPolicy?: AgentSecurityPolicySnapshot;
}): Record<string, any>;
//# sourceMappingURL=index.d.ts.map