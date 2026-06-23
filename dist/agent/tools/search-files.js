import { tool } from 'ai';
import { z } from 'zod';
import { resolve, relative } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
export function createSearchFilesTool(workspaceDir) {
    return tool({
        description: 'Search for patterns in files within the workspace',
        inputSchema: z.object({
            pattern: z.string().describe('Regex pattern to search for'),
            path: z.string().optional().describe('Directory to search in (default: workspace root)'),
            include: z.string().optional().describe('File glob to include (e.g., "*.ts")'),
        }),
        execute: async ({ pattern, path = '.', include }) => {
            try {
                const searchDir = resolve(workspaceDir, path);
                const regex = new RegExp(pattern, 'i');
                const includeRegex = include ? globToRegex(include) : null;
                const matches = [];
                searchDirRecursive(searchDir, regex, includeRegex, matches, workspaceDir, 100);
                return { matches, total: matches.length };
            }
            catch (err) {
                return { matches: [], total: 0, error: err.message };
            }
        },
    });
}
function globToRegex(glob) {
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
}
function searchDirRecursive(dir, pattern, includeRegex, matches, workspaceDir, maxMatches) {
    if (matches.length >= maxMatches)
        return;
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (matches.length >= maxMatches)
            return;
        if (entry.name.startsWith('.') || entry.name === 'node_modules')
            continue;
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            searchDirRecursive(full, pattern, includeRegex, matches, workspaceDir, maxMatches);
        }
        else if (entry.isFile()) {
            if (includeRegex && !includeRegex.test(entry.name))
                continue;
            try {
                const content = readFileSync(full, 'utf-8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
                    if (pattern.test(lines[i])) {
                        const relPath = relative(workspaceDir, full).replace(/\\/g, '/');
                        matches.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
                    }
                }
            }
            catch {
                continue;
            }
        }
    }
}
//# sourceMappingURL=search-files.js.map