import { tool } from 'ai';
import { z } from 'zod';
import { execSync } from 'node:child_process';

export function createInstallPackageTool(workspaceDir: string) {
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
        const stdout = execSync(command, {
          timeout: 60000,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024 * 5,
          cwd: workspaceDir,
        });
        return { stdout, stderr: '', exitCode: 0 };
      } catch (err: any) {
        return {
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? err.message,
          exitCode: err.status ?? 1,
        };
      }
    },
  });
}
