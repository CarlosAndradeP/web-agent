import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { validateCommand, buildWorkspaceEnv, getUnprivilegedExecOptions } from './command-policy.js';
import { logToolExecution } from '../../services/logger.js';
import { PROTECTED_AGENT_SECURITY_POLICY } from '../../services/security-policy.js';
const execAsync = promisify(exec);
export function createRunCommandTool(workspaceDir, securityPolicy = PROTECTED_AGENT_SECURITY_POLICY) {
    return tool({
        description: 'Execute a shell command in the workspace directory',
        inputSchema: z.object({
            command: z.string().describe('Shell command to execute'),
            timeout: z.number().optional().describe('Timeout in seconds (default: 30)'),
        }),
        execute: async ({ command, timeout = 30 }) => {
            const startTime = Date.now();
            logToolExecution('runCommand', undefined, 'start', { input: { command: command.slice(0, 200), timeout } });
            const policyResult = validateCommand(command, workspaceDir, securityPolicy.commandPolicyEnabled);
            if (!policyResult.allowed) {
                logToolExecution('runCommand', undefined, 'error', { error: policyResult.reason, input: { command: command.slice(0, 200) }, durationMs: Date.now() - startTime });
                return { stdout: '', stderr: policyResult.reason, exitCode: 126 };
            }
            try {
                const { stdout, stderr } = await execAsync(command, {
                    cwd: workspaceDir,
                    timeout: timeout * 1000,
                    maxBuffer: 1024 * 1024 * 10,
                    env: buildWorkspaceEnv(workspaceDir),
                    ...getUnprivilegedExecOptions(),
                });
                logToolExecution('runCommand', undefined, 'success', {
                    output: { exitCode: 0, stdoutLength: stdout?.length ?? 0, stderrLength: stderr?.length ?? 0 },
                    durationMs: Date.now() - startTime,
                });
                return { stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 };
            }
            catch (err) {
                logToolExecution('runCommand', undefined, 'error', {
                    error: err.message ?? err.code ?? 'Unknown error',
                    input: { command: command.slice(0, 200) },
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
//# sourceMappingURL=run-command.js.map