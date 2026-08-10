import { tool } from 'ai';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { safeWorkspacePath } from './sanitize.js';
import { sanitizeForPrompt } from './content-sanitize.js';
import { createToolLogger, logToolExecution } from '../../services/logger.js';

const log = createToolLogger('readFile');

export function createReadFileTool(workspaceDir: string) {
  return tool({
    description: 'Read the contents of a file from the workspace',
    inputSchema: z.object({
      path: z.string().describe('Relative path within workspace'),
    }),
    execute: async ({ path }) => {
      const startTime = Date.now();
      logToolExecution('readFile', undefined, 'start', { input: { path } });
      try {
        const fullPath = safeWorkspacePath(workspaceDir, path);
        let content = await readFile(fullPath, 'utf-8');
        content = sanitizeForPrompt(content);
        logToolExecution('readFile', undefined, 'success', { output: { path, contentLength: content.length }, durationMs: Date.now() - startTime });
        return { content, path };
      } catch (err: any) {
        logToolExecution('readFile', undefined, 'error', { error: err.message, input: { path }, durationMs: Date.now() - startTime });
        return { error: err.message, path };
      }
    },
  });
}
