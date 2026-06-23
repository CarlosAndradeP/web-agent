export interface ExecResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
export declare function execCommand(command: string, options?: {
    cwd?: string;
    timeout?: number;
}): ExecResult;
//# sourceMappingURL=execution-sandbox.d.ts.map