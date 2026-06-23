import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);
export function createInstallPackageTool(workspaceDir) {
    return tool({
        description: 'Install an npm or pip package in the workspace',
        inputSchema: z.object({
            package: z.string().describe('Package name (e.g., "lodash" or "requests")'),
            manager: z.enum(['npm', 'pip']).describe('Package manager to use'),
        }),
        execute: async ({ package: pkg, manager }) => {
            try {
                const command = manager === 'npm'
                    ? `npm install --prefix "${workspaceDir}" ${pkg}`
                    : `pip install ${pkg}`;
                const { stdout, stderr } = await execAsync(command, {
                    timeout: 60000,
                    maxBuffer: 1024 * 1024 * 5,
                    cwd: workspaceDir,
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
        },
    });
}
//# sourceMappingURL=install-package.js.map