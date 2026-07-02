import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { safeWorkspacePath } from './sanitize.js';
import { buildSafeEnv } from './command-policy.js';
import { logToolExecution } from '../../services/logger.js';

const execAsync = promisify(exec);

export function createExecuteCodeTool(workspaceDir: string) {
  return tool({
    description: 'Execute JavaScript/TypeScript/Python code and return the result',
    inputSchema: z.object({
      code: z.string().describe('Code to execute'),
      language: z.enum(['javascript', 'typescript', 'python']).describe('Programming language'),
      timeout: z.number().optional().describe('Timeout in seconds (default: 30)'),
    }),
    execute: async ({ code, language, timeout = 30 }) => {
      const startTime = Date.now();
      logToolExecution('executeCode', undefined, 'start', { input: { language, codeLength: code.length, timeout } });

      const tmpDir = safeWorkspacePath(workspaceDir, '.tmp-exec');
      mkdirSync(tmpDir, { recursive: true });
      const ext = language === 'python' ? 'py' : language === 'typescript' ? 'ts' : 'js';
      const filename = `exec-${Date.now()}.${ext}`;
      const filePath = join(tmpDir, filename);
      writeFileSync(filePath, code, 'utf-8');

      let command: string;
      const quotedPath = `"${filePath}"`;
      if (language === 'python') {
        command = `python ${quotedPath}`;
      } else if (language === 'typescript') {
        command = `npx tsx ${quotedPath}`;
      } else {
        command = `node ${quotedPath}`;
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: workspaceDir,
          timeout: timeout * 1000,
          maxBuffer: 1024 * 1024 * 10,
          env: buildSafeEnv(),
        });
        logToolExecution('executeCode', undefined, 'success', {
          output: { exitCode: 0, language, stdoutLength: stdout?.length ?? 0 },
          durationMs: Date.now() - startTime,
        });
        return { stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 };
      } catch (err: any) {
        logToolExecution('executeCode', undefined, 'error', {
          error: err.message ?? err.code ?? 'Unknown error',
          input: { language },
          durationMs: Date.now() - startTime,
        });
        return {
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? err.message,
          exitCode: err.code ?? 1,
        };
      } finally {
        try { rmSync(filePath, { force: true }); } catch {}
      }
    },
  });
}
