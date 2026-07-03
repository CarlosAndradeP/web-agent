import 'dotenv/config';
declare const IS_DOCKER: boolean;
declare function rewriteUrlForDocker(url: string): string;
export declare const config: {
    port: number;
    apiBaseUrl: string;
    apiKey: string;
    workspaceDir: string;
    workspaceBaseDir: string;
    dataDir: string;
    maxSteps: number;
    defaultModel: string;
    agentType: "main" | "sub" | "none";
    jwtSecret: string;
    accessTokenSecret: string;
    refreshTokenSecret: string;
    adminPassword: string;
    initialCredits: number;
    publicBaseUrl: string;
};
export { rewriteUrlForDocker, IS_DOCKER };
//# sourceMappingURL=config.d.ts.map