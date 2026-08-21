import { type AgentSecurityPolicySnapshot } from '../../services/security-policy.js';
export declare function validateUrl(url: string, securityPolicy?: AgentSecurityPolicySnapshot): Promise<{
    allowed: boolean;
    reason?: string;
}>;
export declare function createWebFetchTool(securityPolicy?: AgentSecurityPolicySnapshot): import("ai").Tool<{
    url: string;
}, {
    content: string;
    status: number;
    truncated: boolean;
    error?: undefined;
} | {
    error: any;
    status: number;
    content?: undefined;
    truncated?: undefined;
}>;
//# sourceMappingURL=web-fetch.d.ts.map