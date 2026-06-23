import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const execAsync = promisify(exec);
export function createExecuteCodeTool(workspaceDir) {
    return tool({
        description: 'Execute JavaScript/TypeScript/Python code and return the result',
        inputSchema: z.object({
            code: z.string().describe('Code to execute'),
            language: z.enum(['javascript', 'typescript', 'python']).describe('Programming language'),
            timeout: z.number().optional().describe('Timeout in seconds (default: 30)'),
        }),
        execute: async ({ code, language, timeout = 30 }) => {
            const tmpDir = resolve(workspaceDir, '.tmp-exec');
            mkdirSync(tmpDir, { recursive: true });
            const ext = language === 'python' ? 'py' : language === 'typescript' ? 'ts' : 'js';
            const filename = `exec-${Date.now()}.${ext}`;
            const filePath = join(tmpDir, filename);
            writeFileSync(filePath, code, 'utf-8');
            let command;
            if (language === 'python') {
                command = `python ${filePath}`;
            }
            else if (language === 'typescript') {
                command = `npx tsx ${filePath}`;
            }
            else {
                command = `node ${filePath}`;
            }
            try {
                const { stdout, stderr } = await execAsync(command, {
                    cwd: workspaceDir,
                    timeout: timeout * 1000,
                    maxBuffer: 1024 * 1024 * 10,
                });
                return { stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 };
            }
            catch (err) {
                return {
                    stdout: err.stdout ?? '',
                    stderr: err.stderr ?? err.message,
                    exitCode: err.code ?? 1,
                };
            }
            finally {
                try {
                    rmSync(filePath, { force: true });
                }
                catch { }
            }
        },
    });
}
//# sourceMappingURL=execute-code.js.map