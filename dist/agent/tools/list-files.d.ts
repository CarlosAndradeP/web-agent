export declare function createListFilesTool(workspaceDir: string): import("ai").Tool<{
    path?: string | undefined;
    recursive?: boolean | undefined;
}, {
    entries: {
        name: string;
        type: string;
        size?: number;
        children?: any[];
    }[];
    path: string;
    error?: undefined;
} | {
    error: any;
    path: string;
    entries?: undefined;
}>;
//# sourceMappingURL=list-files.d.ts.map