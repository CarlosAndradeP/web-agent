import { tool } from 'ai';
import { z } from 'zod';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
export function createReadFileTool(workspaceDir) {
    return tool({
        description: 'Read the contents of a file from the workspace',
        inputSchema: z.object({
            path: z.string().describe('Relative path within workspace'),
        }),
        execute: async ({ path }) => {
            try {
                const fullPath = resolve(workspaceDir, path);
                const content = readFileSync(fullPath, 'utf-8');
                return { content, path };
            }
            catch (err) {
                return { error: err.message, path };
            }
        },
    });
}
//# sourceMappingURL=read-file.js.map