export declare function createWriteFileTool(workspaceDir: string): import("ai").Tool<{
    path: string;
    content: string;
}, {
    success: boolean;
    path: string;
    error?: undefined;
} | {
    error: any;
    path: string;
    success?: undefined;
}>;
//# sourceMappingURL=write-file.d.ts.map