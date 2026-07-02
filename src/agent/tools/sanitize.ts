import { resolve, sep, relative, isAbsolute } from 'node:path';

export function safeWorkspacePath(workspaceDir: string, relativePath: string): string {
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

  return fullPath;
}
