import { tool } from 'ai';
import { z } from 'zod';
import { rm } from 'node:fs/promises';
import { safeWorkspacePath } from './sanitize.js';
import { logToolExecution } from '../../services/logger.js';

export function createDeleteFileTool(workspaceDir: string) {
  return tool({
    description: 'Delete a file or directory from the workspace',
    inputSchema: z.object({
      path: z.string().describe('Relative path within workspace'),
    }),
    execute: async ({ path }) => {
      const startTime = Date.now();
      logToolExecution('deleteFile', undefined, 'start', { input: { path } });
      try {
        const fullPath = safeWorkspacePath(workspaceDir, path);
        await rm(fullPath, { recursive: true, force: true });
        logToolExecution('deleteFile', undefined, 'success', { output: { path }, durationMs: Date.now() - startTime });
        return { success: true, path };
      } catch (err: any) {
        logToolExecution('deleteFile', undefined, 'error', { error: err.message, input: { path }, durationMs: Date.now() - startTime });
        return { error: err.message, path };
      }
    },
  });
}
