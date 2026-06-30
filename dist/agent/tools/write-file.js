import { tool } from 'ai';
import { z } from 'zod';
import { dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { safeWorkspacePath } from './sanitize.js';
import { logToolExecution } from '../../services/logger.js';
export function createWriteFileTool(workspaceDir) {
    return tool({
        description: 'Create or overwrite a file in the workspace',
        inputSchema: z.object({
            path: z.string().describe('Relative path within workspace'),
            content: z.string().describe('File content to write'),
        }),
        execute: async ({ path, content }) => {
            const startTime = Date.now();
            logToolExecution('writeFile', undefined, 'start', { input: { path, contentLength: content.length } });
            try {
                const fullPath = safeWorkspacePath(workspaceDir, path);
                await mkdir(dirname(fullPath), { recursive: true });
                await writeFile(fullPath, content, 'utf-8');
                logToolExecution('writeFile', undefined, 'success', { output: { path, contentLength: content.length }, durationMs: Date.now() - startTime });
                return { success: true, path };
            }
            catch (err) {
                logToolExecution('writeFile', undefined, 'error', { error: err.message, input: { path }, durationMs: Date.now() - startTime });
                return { error: err.message, path };
            }
        },
    });
}
//# sourceMappingURL=write-file.js.map