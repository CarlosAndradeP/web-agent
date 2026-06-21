import { tool } from 'ai';
import { z } from 'zod';
import { resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

export function createWriteFileTool(workspaceDir: string) {
  return tool({
    description: 'Create or overwrite a file in the workspace',
    inputSchema: z.object({
      path: z.string().describe('Relative path within workspace'),
      content: z.string().describe('File content to write'),
    }),
    execute: async ({ path, content }) => {
      const fullPath = resolve(workspaceDir, path);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, 'utf-8');
      return { success: true, path };
    },
  });
}
