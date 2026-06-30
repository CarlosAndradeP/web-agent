import type { ApprovalMode } from '../../types/index.js';
import type { ApprovalManager } from '../../services/approval-manager.js';
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
}): Record<string, any>;
//# sourceMappingURL=index.d.ts.map