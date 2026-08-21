export declare function validateCommand(command: string, workspaceDir?: string, policyEnabled?: boolean): {
    allowed: boolean;
    reason?: string;
};
export declare function buildSafeEnv(additionalEnv?: Record<string, string>): Record<string, string>;
export declare function buildWorkspaceEnv(workspaceDir: string, additionalEnv?: Record<string, string>): Record<string, string>;
export declare function getUnprivilegedExecOptions(): {
    uid?: number;
    gid?: number;
};
//# sourceMappingURL=command-policy.d.ts.map