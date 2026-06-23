export declare function createSearchFilesTool(workspaceDir: string): import("ai").Tool<{
    pattern: string;
    path?: string | undefined;
    include?: string | undefined;
}, {
    matches: string[];
    total: number;
    error?: undefined;
} | {
    matches: never[];
    total: number;
    error: any;
}>;
//# sourceMappingURL=search-files.d.ts.map