import { tool } from 'ai';
import { z } from 'zod';
import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { safeWorkspacePath } from './sanitize.js';
export function createListFilesTool(workspaceDir) {
    return tool({
        description: 'List files and directories in the workspace',
        inputSchema: z.object({
            path: z.string().optional().describe('Relative directory path (default: workspace root)'),
            recursive: z.boolean().optional().describe('List recursively (default: false)'),
        }),
        execute: async ({ path = '.', recursive = false }) => {
            try {
                const fullPath = safeWorkspacePath(workspaceDir, path);
                const entries = listDir(fullPath, recursive);
                return { entries, path };
            }
            catch (err) {
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