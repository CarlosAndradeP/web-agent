import { execSync } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function execCommand(command: string, options: { cwd?: string; timeout?: number } = {}): ExecResult {
  try {
    const stdout = execSync(command, {
      cwd: options.cwd,
      timeout: options.timeout ?? 30000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 10,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message,
      exitCode: err.status ?? 1,
    };
  }
}
