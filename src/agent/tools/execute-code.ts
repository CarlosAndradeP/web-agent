import { tool } from 'ai';
import { z } from 'zod';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createExecuteCodeTool(workspaceDir: string) {
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

      let command: string;
      if (language === 'python') {
        command = `python ${filePath}`;
      } else if (language === 'typescript') {
        command = `npx tsx ${filePath}`;
      } else {
        command = `node ${filePath}`;
      }

      try {
        const stdout = execSync(command, {
          cwd: workspaceDir,
          timeout: timeout * 1000,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024 * 10,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { stdout, stderr: '', exitCode: 0 };
      } catch (err: any) {
        return {
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? err.message,
          exitCode: err.status ?? 1,
        };
      } finally {
        try { rmSync(filePath, { force: true }); } catch {}
      }
    },
  });
}
