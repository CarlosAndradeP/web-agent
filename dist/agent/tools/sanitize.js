import { resolve } from 'node:path';
export function safeWorkspacePath(workspaceDir, relativePath) {
    const fullPath = resolve(workspaceDir, relativePath);
    const normalizedWorkspace = resolve(workspaceDir);
    if (!fullPath.startsWith(normalizedWorkspace)) {
        throw new Error(`Path traversal blocked: ${relativePath} resolves outside workspace`);
    }
    return fullPath;
}
//# sourceMappingURL=sanitize.js.map