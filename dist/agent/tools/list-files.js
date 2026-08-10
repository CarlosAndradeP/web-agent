import { tool } from 'ai';
import { z } from 'zod';
import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { safeWorkspacePath } from './sanitize.js';
import { logToolExecution } from '../../services/logger.js';
export function createListFilesTool(workspaceDir) {
    return tool({
        description: 'List files and directories in the workspace',
        inputSchema: z.object({
            path: z.string().optional().describe('Relative directory path (default: workspace root)'),
            recursive: z.boolean().optional().describe('List recursively (default: false)'),
        }),
        execute: async ({ path = '.', recursive = false }) => {
            const startTime = Date.now();
            logToolExecution('listFiles', undefined, 'start', { input: { path, recursive } });
            try {
                const fullPath = safeWorkspacePath(workspaceDir, path);
                const entries = listDir(fullPath, recursive);
                logToolExecution('listFiles', undefined, 'success', { output: { entryCount: entries.length }, durationMs: Date.now() - startTime });
                return { entries, path };
            }
            catch (err) {
                logToolExecution('listFiles', undefined, 'error', { error: err.message, input: { path }, durationMs: Date.now() - startTime });
                return { error: err.message, path };
            }
        },
    });
}
function listDir(dirPath, recursive) {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    return entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .map(e => {
        const full = resolve(dirPath, e.name);
        if (e.isDirectory()) {
            return {
                name: e.name,
                type: 'directory',
                children: recursive ? listDir(full, true) : undefined,
            };
        }
        try {
            return { name: e.name, type: 'file', size: statSync(full).size };
        }
        catch {
            return { name: e.name, type: 'file' };
        }
    });
}
//# sourceMappingURL=list-files.js.map