import { tool } from 'ai';
import { z } from 'zod';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
export function createDeleteFileTool(workspaceDir) {
    return tool({
        description: 'Delete a file or directory from the workspace',
        inputSchema: z.object({
            path: z.string().describe('Relative path within workspace'),
        }),
        execute: async ({ path }) => {
            try {
                const fullPath = resolve(workspaceDir, path);
                rmSync(fullPath, { recursive: true, force: true });
                return { success: true, path };
            }
            catch (err) {
                return { error: err.message, path };
            }
        },
    });
}
//# sourceMappingURL=delete-file.js.map