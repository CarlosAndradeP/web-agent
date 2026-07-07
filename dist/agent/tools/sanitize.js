import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep, relative } from 'node:path';
export function safeWorkspacePath(workspaceDir, relativePath) {
    const fullPath = resolve(workspaceDir, relativePath);
    const normalizedWorkspace = resolve(workspaceDir);
    const safePrefix = normalizedWorkspace.endsWith(sep)
        ? normalizedWorkspace
        : normalizedWorkspace + sep;
    if (fullPath !== normalizedWorkspace && !fullPath.startsWith(safePrefix)) {
        throw new Error(`Path traversal blocked: ${relativePath} resolves outside workspace`);
    }
    // Defense in depth: ensure the resolved path never escapes the workspace
    // root via ".." or drive change (e.g. "D:\evil" on Windows). `relative()`
    // returns a path starting with ".." when fullPath is outside the workspace.
    const relFromWorkspace = relative(normalizedWorkspace, fullPath).replace(/\\/g, '/');
    if (relFromWorkspace.startsWith('..')) {
        throw new Error(`Path traversal blocked: ${relativePath} resolves outside workspace`);
    }
    assertRealPathInsideWorkspace(normalizedWorkspace, fullPath, relativePath);
    return fullPath;
}
export function assertPathInsideWorkspace(workspaceDir, candidatePath, label = candidatePath) {
    const fullPath = resolve(candidatePath);
    const normalizedWorkspace = resolve(workspaceDir);
    const safePrefix = normalizedWorkspace.endsWith(sep)
        ? normalizedWorkspace
        : normalizedWorkspace + sep;
    if (fullPath !== normalizedWorkspace && !fullPath.startsWith(safePrefix)) {
        throw new Error(`Path blocked: ${label} resolves outside workspace`);
    }
    const relFromWorkspace = relative(normalizedWorkspace, fullPath).replace(/\\/g, '/');
    if (relFromWorkspace.startsWith('..')) {
        throw new Error(`Path blocked: ${label} resolves outside workspace`);
    }
    assertRealPathInsideWorkspace(normalizedWorkspace, fullPath, label);
    return fullPath;
}
function assertRealPathInsideWorkspace(workspaceDir, fullPath, label) {
    const workspaceReal = realpathIfExists(workspaceDir) ?? workspaceDir;
    const existingPath = nearestExistingPath(fullPath);
    if (!existingPath)
        return;
    const realExisting = realpathIfExists(existingPath);
    if (!realExisting)
        return;
    const safePrefix = workspaceReal.endsWith(sep) ? workspaceReal : workspaceReal + sep;
    if (realExisting !== workspaceReal && !realExisting.startsWith(safePrefix)) {
        throw new Error(`Path blocked: ${label} resolves through a symlink outside workspace`);
    }
}
function nearestExistingPath(path) {
    let current = path;
    while (current && current !== dirname(current)) {
        if (existsSync(current))
            return current;
        current = dirname(current);
    }
    return existsSync(current) ? current : null;
}
function realpathIfExists(path) {
    try {
        return realpathSync.native(path);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=sanitize.js.map