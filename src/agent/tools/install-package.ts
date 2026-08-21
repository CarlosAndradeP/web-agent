import { tool } from 'ai';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateCommand, buildWorkspaceEnv, getUnprivilegedExecOptions } from './command-policy.js';
import { logToolExecution } from '../../services/logger.js';
import { PROTECTED_AGENT_SECURITY_POLICY, type AgentSecurityPolicySnapshot } from '../../services/security-policy.js';

const execFileAsync = promisify(execFile);

const ALLOWED_NPM_SCOPE_PREFIXES = ['@'];
const BLOCKED_PACKAGES = [
  'prettier-plugin-exec',
  'vue-cli-plugin-exec',
  'babel-plugin-exec',
];

function validatePackageName(pkg: string, manager: 'npm' | 'pip', policyEnabled: boolean): { allowed: boolean; reason?: string } {
  if (policyEnabled && BLOCKED_PACKAGES.includes(pkg.toLowerCase())) {
    return { allowed: false, reason: `Package "${pkg}" is blocked by security policy` };
  }

  if (manager === 'npm') {
    const isScoped = ALLOWED_NPM_SCOPE_PREFIXES.some(prefix => pkg.startsWith(prefix));
    const simpleName = /^[a-z0-9][a-z0-9._-]*$/.test(pkg);
    if (!isScoped && !simpleName) {
      return { allowed: false, reason: `Invalid npm package name: ${pkg}` };
    }
    // For scoped packages, validate the full pattern: @scope/name
    if (isScoped && !/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(pkg)) {
      return { allowed: false, reason: `Invalid scoped npm package name: ${pkg}` };
    }
  }

  // Shell metacharacter check — reject any package with shell-exploitable chars
  if (/[;|&`$(){}[\]<>!~#\\'" \n\r\t]/.test(pkg)) {
    return { allowed: false, reason: `Package name contains invalid characters: ${pkg}` };
  }

  return { allowed: true };
}

export function createInstallPackageTool(workspaceDir: string, securityPolicy: AgentSecurityPolicySnapshot = PROTECTED_AGENT_SECURITY_POLICY) {
  return tool({
    description: securityPolicy.packagePolicyEnabled
      ? 'Install an npm or pip package in the workspace (npm lifecycle scripts disabled)'
      : 'Install an npm or pip package in the workspace (npm lifecycle scripts allowed)',
    inputSchema: z.object({
      package: z.string().describe('Package name (e.g., "lodash" or "requests")'),
      manager: z.enum(['npm', 'pip']).describe('Package manager to use'),
    }),
    execute: async ({ package: pkg, manager }) => {
      const startTime = Date.now();
      logToolExecution('installPackage', undefined, 'start', { input: { package: pkg, manager } });

      const pkgCheck = validatePackageName(pkg, manager, securityPolicy.packagePolicyEnabled);
      if (!pkgCheck.allowed) {
        logToolExecution('installPackage', undefined, 'error', { error: pkgCheck.reason, input: { package: pkg }, durationMs: Date.now() - startTime });
        return { stdout: '', stderr: pkgCheck.reason!, exitCode: 126 };
      }

      const ignoreScripts = securityPolicy.packagePolicyEnabled ? ' --ignore-scripts' : '';
      const command = manager === 'npm'
        ? `npm install --prefix "${workspaceDir}" ${pkg}${ignoreScripts}`
        : `pip install --no-cache-dir ${pkg}`;
      const policyResult = validateCommand(command, workspaceDir, securityPolicy.commandPolicyEnabled);
      if (!policyResult.allowed) {
        logToolExecution('installPackage', undefined, 'error', { error: policyResult.reason, input: { package: pkg }, durationMs: Date.now() - startTime });
        return { stdout: '', stderr: policyResult.reason!, exitCode: 126 };
      }

      try {
        let stdout: string, stderr: string;
        if (manager === 'npm') {
          const npmArgs = ['install', '--prefix', workspaceDir, pkg];
          if (securityPolicy.packagePolicyEnabled) npmArgs.push('--ignore-scripts');
          ({ stdout, stderr } = await execFileAsync('npm', npmArgs, {
            timeout: 60000,
            maxBuffer: 1024 * 1024 * 5,
            cwd: workspaceDir,
            env: buildWorkspaceEnv(workspaceDir),
            ...getUnprivilegedExecOptions(),
          }));
        } else {
          ({ stdout, stderr } = await execFileAsync('pip', ['install', '--no-cache-dir', '--target', workspaceDir, pkg], {
            timeout: 60000,
            maxBuffer: 1024 * 1024 * 5,
            cwd: workspaceDir,
            env: buildWorkspaceEnv(workspaceDir),
            ...getUnprivilegedExecOptions(),
          }));
        }
        logToolExecution('installPackage', undefined, 'success', { output: { package: pkg, manager }, durationMs: Date.now() - startTime });
        return { stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 };
      } catch (err: any) {
        logToolExecution('installPackage', undefined, 'error', {
          error: err.stderr ?? err.message,
          input: { package: pkg, manager },
          durationMs: Date.now() - startTime,
        });
        return {
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? err.message,
          exitCode: err.code ?? 1,
        };
      }
    },
  });
}
