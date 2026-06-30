import { resolve, sep } from 'node:path';
export function safeWorkspacePath(workspaceDir, relativePath) {
    const fullPath = resolve(workspaceDir, relativePath);
    const normalizedWorkspace = resolve(workspaceDir);
    const safePrefix = normalizedWorkspace.endsWith(sep)
        ? normalizedWorkspace
        : normalizedWorkspace + sep;
    if (fullPath !== normalizedWorkspace && !fullPath.startsWith(safePrefix)) {
        throw new Error(`Path traversal blocked: ${relativePath} resolves outside workspace`);
    }
    return fullPath;
}
//# sourceMappingURL=sanitize.js.map