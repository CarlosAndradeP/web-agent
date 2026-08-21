import { tool } from 'ai';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { safeWorkspacePath } from './sanitize.js';
import { buildWorkspaceEnv, getUnprivilegedExecOptions } from './command-policy.js';
import { logToolExecution } from '../../services/logger.js';
import { PROTECTED_AGENT_SECURITY_POLICY, type AgentSecurityPolicySnapshot } from '../../services/security-policy.js';

const execFileAsync = promisify(execFile);

const JS_BLOCKED_PATTERNS = [
  /\b(?:import|require)\b/,
  /\bcreateRequire\b/,
  /\bprocess\.(?:env|binding|dlopen|kill|exit|chdir)\b/,
  /\b(?:eval|Function)\s*\(/,
  /\bconstructor\s*\.\s*constructor\b/,
  /\b(__proto__|prototype|globalThis|window|document)\b/,
  /\bfetch\s*\(/,
  /\bWebSocket\b/,
  /(?:^|[^.\w])(?:\/app|\/etc|\/proc|\/sys|\/root|\/var|[A-Za-z]:[\\/])/,
  /(?:^|[\\/])\.\.(?:[\\/]|$)/,
];

const PY_BLOCKED_PATTERNS = [
  /^\s*(?:import|from)\s+(?:os|subprocess|socket|http|urllib|ftplib|sqlite3|ctypes|multiprocessing|pathlib|shutil|glob|importlib|sys)\b/m,
  /\b__import__\s*\(/,
  /\b(?:eval|exec|compile)\s*\(/,
  /\bopen\s*\(\s*['"](?:\/|[A-Za-z]:[\\/])/,
  /(?:^|[^.\w])(?:\/app|\/etc|\/proc|\/sys|\/root|\/var|[A-Za-z]:[\\/])/,
  /(?:^|[\\/])\.\.(?:[\\/]|$)/,
];

const PYTHON_WRAPPER = String.raw`
import builtins
import io
import os
import runpy
import sys

workspace = os.path.realpath(os.environ["EXECUTE_CODE_WORKSPACE"])
target = os.path.realpath(os.environ["EXECUTE_CODE_TARGET"])
allowed_imports = {
    "base64", "collections", "csv", "datetime", "decimal", "functools",
    "hashlib", "heapq", "itertools", "json", "math", "random", "re",
    "statistics", "string", "time", "typing", "uuid"
}

def is_inside(path):
    real = os.path.realpath(path)
    return real == workspace or real.startswith(workspace + os.sep)

def safe_open(file, mode="r", *args, **kwargs):
    if not is_inside(str(file)):
        raise PermissionError("executeCode can only access files inside the workspace")
    return original_open(file, mode, *args, **kwargs)

def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    root = name.split(".", 1)[0]
    if root not in allowed_imports:
        raise ImportError(f"Module '{root}' is not allowed in executeCode")
    return original_import(name, globals, locals, fromlist, level)

original_open = builtins.open
original_import = builtins.__import__
builtins.open = safe_open
builtins.__import__ = guarded_import

if not is_inside(target):
    raise PermissionError("Target script is outside the workspace")

with original_open(target, "r", encoding="utf-8") as handle:
    source = handle.read()
exec(compile(source, target, "exec"), {"__builtins__": builtins.__dict__, "__name__": "__main__"})
`;

const JS_WRAPPER = String.raw`
const fs = require('node:fs');
const vm = require('node:vm');

const target = process.env.EXECUTE_CODE_TARGET;
const code = fs.readFileSync(target, 'utf8');
const context = vm.createContext({
  console,
  Math,
  JSON,
  Date,
  RegExp,
  String,
  Number,
  Boolean,
  Array,
  Object,
  Map,
  Set,
  WeakMap,
  WeakSet,
  Promise,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
}, {
  codeGeneration: { strings: false, wasm: false },
});

const script = new vm.Script(code, {
  filename: target,
  displayErrors: true,
});
script.runInContext(context, {
  timeout: Number(process.env.EXECUTE_CODE_TIMEOUT_MS || 30000),
  displayErrors: true,
});
`;

export function createExecuteCodeTool(workspaceDir: string, securityPolicy: AgentSecurityPolicySnapshot = PROTECTED_AGENT_SECURITY_POLICY) {
  return tool({
    description: 'Execute JavaScript/TypeScript/Python code and return the result',
    inputSchema: z.object({
      code: z.string().describe('Code to execute'),
      language: z.enum(['javascript', 'typescript', 'python']).describe('Programming language'),
      timeout: z.number().optional().describe('Timeout in seconds (default: 30)'),
    }),
    execute: async ({ code, language, timeout = 30 }) => {
      const startTime = Date.now();
      logToolExecution('executeCode', undefined, 'start', { input: { language, codeLength: code.length, timeout } });

      const safety = securityPolicy.codePolicyEnabled ? validateCodeSafety(code, language) : { allowed: true };
      if (!safety.allowed) {
        logToolExecution('executeCode', undefined, 'error', { error: safety.reason, input: { language }, durationMs: Date.now() - startTime });
        return { stdout: '', stderr: safety.reason!, exitCode: 126 };
      }

      const tmpDir = safeWorkspacePath(workspaceDir, '.tmp-exec');
      mkdirSync(tmpDir, { recursive: true });
      const ext = language === 'python' ? 'py' : language === 'typescript' ? 'ts' : 'js';
      const filename = `exec-${Date.now()}.${ext}`;
      const filePath = join(tmpDir, filename);
      const executableCode = language === 'typescript' ? stripBasicTypeScript(code) : code;
      writeFileSync(filePath, executableCode, 'utf-8');

      let command: string;
      let args: string[];
      let wrapperPath: string | null = null;
      if (language === 'python') {
        wrapperPath = join(tmpDir, `wrapper-${Date.now()}.py`);
        writeFileSync(wrapperPath, PYTHON_WRAPPER, 'utf-8');
        command = process.platform === 'win32' ? 'py' : 'python3';
        args = ['-I', wrapperPath];
      } else {
        wrapperPath = join(tmpDir, `wrapper-${Date.now()}.cjs`);
        writeFileSync(wrapperPath, JS_WRAPPER, 'utf-8');
        command = 'node';
        args = [
          '--permission',
          `--allow-fs-read=${wrapperPath}`,
          `--allow-fs-read=${filePath}`,
          '--no-addons',
          '--disallow-code-generation-from-strings',
          wrapperPath,
        ];
      }

      try {
        const { stdout, stderr } = await execFileAsync(command, args, {
          cwd: workspaceDir,
          timeout: timeout * 1000,
          maxBuffer: 1024 * 1024 * 10,
          env: buildWorkspaceEnv(workspaceDir, {
            EXECUTE_CODE_WORKSPACE: workspaceDir,
            EXECUTE_CODE_TARGET: filePath,
            EXECUTE_CODE_TIMEOUT_MS: String(timeout * 1000),
          }),
          ...getUnprivilegedExecOptions(),
        });
        logToolExecution('executeCode', undefined, 'success', {
          output: { exitCode: 0, language, stdoutLength: stdout?.length ?? 0 },
          durationMs: Date.now() - startTime,
        });
        return { stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 };
      } catch (err: any) {
        logToolExecution('executeCode', undefined, 'error', {
          error: err.message ?? err.code ?? 'Unknown error',
          input: { language },
          durationMs: Date.now() - startTime,
        });
        return {
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? err.message,
          exitCode: err.code ?? 1,
        };
      } finally {
        try { rmSync(filePath, { force: true }); } catch {}
        if (wrapperPath) {
          try { rmSync(wrapperPath, { force: true }); } catch {}
        }
      }
    },
  });
}

function validateCodeSafety(code: string, language: 'javascript' | 'typescript' | 'python'): { allowed: boolean; reason?: string } {
  const patterns = language === 'python' ? PY_BLOCKED_PATTERNS : JS_BLOCKED_PATTERNS;
  for (const pattern of patterns) {
    if (pattern.test(code)) {
      return {
        allowed: false,
        reason: 'executeCode blocked code that can access system resources, network, process internals, or paths outside the workspace',
      };
    }
  }
  return { allowed: true };
}

function stripBasicTypeScript(code: string): string {
  return code
    .replace(/^\s*interface\s+\w+\s*{[^}]*}\s*/gm, '')
    .replace(/^\s*type\s+\w+\s*=\s*[^;]+;\s*/gm, '')
    .replace(/:\s*[A-Za-z_$][\w$<>,[\] |.&?]*(?=\s*[,)=;])/g, '')
    .replace(/\s+as\s+[A-Za-z_$][\w$<>,[\] |.&?]*/g, '');
}
