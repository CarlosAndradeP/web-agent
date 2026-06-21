import { tool } from 'ai';
import { z } from 'zod';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

export function createSearchFilesTool(workspaceDir: string) {
  return tool({
    description: 'Search for patterns in files within the workspace',
    inputSchema: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      path: z.string().optional().describe('Directory to search in (default: workspace root)'),
      include: z.string().optional().describe('File pattern to include (e.g., "*.ts")'),
    }),
    execute: async ({ pattern, path = '.', include }) => {
      try {
        const searchDir = resolve(workspaceDir, path);
        let cmd = `grep -rn --include="${include ?? '*'}" -E "${pattern.replace(/"/g, '\\"')}" "${searchDir}" --max-count=100 || true`;
        const output = execSync(cmd, {
          encoding: 'utf-8',
          timeout: 15000,
          maxBuffer: 1024 * 1024 * 5,
        });
        const lines = output.trim().split('\n').filter(Boolean).slice(0, 100);
        return { matches: lines, total: lines.length };
      } catch (err: any) {
        return { matches: [], total: 0, error: err.message };
      }
    },
  });
}
