import { tool } from 'ai';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { safeWorkspacePath } from './sanitize.js';
import { sanitizeForPrompt } from './content-sanitize.js';
export function createReadFileTool(workspaceDir) {
    return tool({
        description: 'Read the contents of a file from the workspace',
        inputSchema: z.object({
            path: z.string().describe('Relative path within workspace'),
        }),
        execute: async ({ path }) => {
            try {
                const fullPath = safeWorkspacePath(workspaceDir, path);
                let content = readFileSync(fullPath, 'utf-8');
                content = sanitizeForPrompt(content);
                return { content, path };
            }
            catch (err) {
                return { error: err.message, path };
            }
        },
    });
}
//# sourceMappingURL=read-file.js.map