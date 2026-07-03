import { isAbsolute, resolve } from 'node:path';
import { config } from '../config.js';
import { safeWorkspacePath } from '../agent/tools/sanitize.js';

export function getUserWorkspaceDir(username: string): string {
  return resolve(config.workspaceBaseDir, username);
}

export function resolveUserWorkspacePath(username: string, relativePath: string, options: { allowRoot?: boolean } = {}): string {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('folderPath is required');
  }

  const normalizedInput = relativePath.replace(/\\/g, '/').trim();
  if (isAbsolute(normalizedInput)) {
    throw new Error('folderPath must be relative to the user workspace');
  }

  const segments = normalizedInput.split('/').filter(Boolean);
  if (segments.includes('..')) {
    throw new Error('folderPath cannot contain .. segments');
  }

  if (!options.allowRoot && (normalizedInput === '.' || segments.length === 0)) {
    throw new Error('folderPath must point to a project folder');
  }

  return safeWorkspacePath(getUserWorkspaceDir(username), normalizedInput);
}
