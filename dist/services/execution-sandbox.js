import { execSync } from 'node:child_process';
export function execCommand(command, options = {}) {
    try {
        const stdout = execSync(command, {
            cwd: options.cwd,
            timeout: options.timeout ?? 30000,
            encoding: 'utf-8',
            maxBuffer: 1024 * 1024 * 10,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { stdout, stderr: '', exitCode: 0 };
    }
    catch (err) {
        return {
            stdout: err.stdout ?? '',
            stderr: err.stderr ?? err.message,
            exitCode: err.status ?? 1,
        };
    }
}
//# sourceMappingURL=execution-sandbox.js.map