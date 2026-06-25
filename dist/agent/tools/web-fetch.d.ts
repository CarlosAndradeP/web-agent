export declare function validateUrl(url: string): {
    allowed: boolean;
    reason?: string;
};
export declare function createWebFetchTool(): import("ai").Tool<{
    url: string;
    format?: "text" | "html" | "json" | undefined;
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