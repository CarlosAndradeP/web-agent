import { tool } from 'ai';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateCommand, buildSafeEnv } from './command-policy.js';
import { logToolExecution } from '../../services/logger.js';
const execFileAsync = promisify(execFile);
const ALLOWED_NPM_SCOPE_PREFIXES = ['@'];
const BLOCKED_PACKAGES = [
    'prettier-plugin-exec',
    'vue-cli-plugin-exec',
    'babel-plugin-exec',
];
function validatePackageName(pkg, manager) {
    if (BLOCKED_PACKAGES.includes(pkg.toLowerCase())) {
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
export function createInstallPackageTool(workspaceDir) {
    return tool({
        description: 'Install an npm or pip package in the workspace',
        inputSchema: z.object({
            package: z.string().describe('Package name (e.g., "lodash" or "requests")'),
            manager: z.enum(['npm', 'pip']).describe('Package manager to use'),
        }),
        execute: async ({ package: pkg, manager }) => {
            const startTime = Date.now();
            logToolExecution('installPackage', undefined, 'start', { input: { package: pkg, manager } });
            const pkgCheck = validatePackageName(pkg, manager);
            if (!pkgCheck.allowed) {
                logToolExecution('installPackage', undefined, 'error', { error: pkgCheck.reason, input: { package: pkg }, durationMs: Date.now() - startTime });
                return { stdout: '', stderr: pkgCheck.reason, exitCode: 126 };
            }
            const command = manager === 'npm'
                ? `npm install --prefix "${workspaceDir}" ${pkg} --ignore-scripts`
                : `pip install --no-cache-dir ${pkg}`;
            const policyResult = validateCommand(command);
            if (!policyResult.allowed) {
                logToolExecution('installPackage', undefined, 'error', { error: policyResult.reason, input: { package: pkg }, durationMs: Date.now() - startTime });
                return { stdout: '', stderr: policyResult.reason, exitCode: 126 };
            }
            try {
                let stdout, stderr;
                if (manager === 'npm') {
                    ({ stdout, stderr } = await execFileAsync('npm', ['install', '--prefix', workspaceDir, pkg, '--ignore-scripts'], {
                        timeout: 60000,
                        maxBuffer: 1024 * 1024 * 5,
                        cwd: workspaceDir,
                        env: buildSafeEnv(),
                    }));
                }
                else {
                    ({ stdout, stderr } = await execFileAsync('pip', ['install', '--no-cache-dir', pkg], {
                        timeout: 60000,
                        maxBuffer: 1024 * 1024 * 5,
                        cwd: workspaceDir,
                        env: buildSafeEnv(),
                    }));
                }
                logToolExecution('installPackage', undefined, 'success', { output: { package: pkg, manager }, durationMs: Date.now() - startTime });
                return { stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 };
            }
            catch (err) {
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
//# sourceMappingURL=install-package.js.map