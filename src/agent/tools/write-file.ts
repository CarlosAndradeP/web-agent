import { tool } from 'ai';
import { z } from 'zod';
import { dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { safeWorkspacePath } from './sanitize.js';

export function createWriteFileTool(workspaceDir: string) {
  return tool({
    description: 'Create or overwrite a file in the workspace',
    inputSchema: z.object({
      path: z.string().describe('Relative path within workspace'),
      content: z.string().describe('File content to write'),
    }),
    execute: async ({ path, content }) => {
      try {
        const fullPath = safeWorkspacePath(workspaceDir, path);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content, 'utf-8');
        return { success: true, path };
      } catch (err: any) {
        return { error: err.message, path };
      }
    },
  });
}
