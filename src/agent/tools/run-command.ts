import { tool } from 'ai';
import { z } from 'zod';
import { resolve } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export function createRunCommandTool(workspaceDir: string) {
  return tool({
    description: 'Execute a shell command in the workspace directory',
    inputSchema: z.object({
      command: z.string().describe('Shell command to execute'),
      timeout: z.number().optional().describe('Timeout in seconds (default: 30)'),
    }),
    execute: async ({ command, timeout = 30 }) => {
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: workspaceDir,
          timeout: timeout * 1000,
          maxBuffer: 1024 * 1024 * 10,
        });
        return { stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 };
      } catch (err: any) {
        return {
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? err.message,
          exitCode: err.code ?? 1,
        };
      }
    },
  });
}
