import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { validateCommand, buildSafeEnv } from './command-policy.js';

const execAsync = promisify(exec);

const ALLOWED_NPM_SCOPE_PREFIXES = ['@'];
const BLOCKED_PACKAGES = [
  'prettier-plugin-exec',
  'vue-cli-plugin-exec',
  'babel-plugin-exec',
];

function validatePackageName(pkg: string, manager: 'npm' | 'pip'): { allowed: boolean; reason?: string } {
  if (BLOCKED_PACKAGES.includes(pkg.toLowerCase())) {
    return { allowed: false, reason: `Package "${pkg}" is blocked by security policy` };
  }

  if (manager === 'npm') {
    const isScoped = ALLOWED_NPM_SCOPE_PREFIXES.some(prefix => pkg.startsWith(prefix));
    const simpleName = /^[a-z0-9][a-z0-9._-]*$/.test(pkg);
    if (!isScoped && !simpleName) {
      return { allowed: false, reason: `Invalid npm package name: ${pkg}` };
    }
  }

  return { allowed: true };
}

export function createInstallPackageTool(workspaceDir: string) {
  return tool({
    description: 'Install an npm or pip package in the workspace',
    inputSchema: z.object({
      package: z.string().describe('Package name (e.g., "lodash" or "requests")'),
      manager: z.enum(['npm', 'pip']).describe('Package manager to use'),
    }),
    execute: async ({ package: pkg, manager }) => {
      const pkgCheck = validatePackageName(pkg, manager);
      if (!pkgCheck.allowed) {
        return { stdout: '', stderr: pkgCheck.reason!, exitCode: 126 };
      }

      const command = manager === 'npm'
        ? `npm install --prefix "${workspaceDir}" ${pkg} --ignore-scripts`
        : `pip install --no-cache-dir ${pkg}`;

      const policyResult = validateCommand(command);
      if (!policyResult.allowed) {
        return { stdout: '', stderr: policyResult.reason!, exitCode: 126 };
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: 60000,
          maxBuffer: 1024 * 1024 * 5,
          cwd: workspaceDir,
          env: buildSafeEnv(),
        });
        return { stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 };
      } catch (err: any) {
        return {
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? err.message,
          exitCode: err.code ?? 1,
        };
      }
    },
  });
}
