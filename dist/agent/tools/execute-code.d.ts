export declare function createExecuteCodeTool(workspaceDir: string): import("ai").Tool<{
    code: string;
    language: "javascript" | "typescript" | "python";
    timeout?: number | undefined;
}, {
    stdout: any;
    stderr: any;
    exitCode: any;
}>;
//# sourceMappingURL=execute-code.d.ts.map