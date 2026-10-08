import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Execute npm without a shell, including Windows npm.cmd installations. */
export function npmCommand(args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command: 'npm', args };
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ...(process.env.PATH ?? process.env.Path ?? '').split(';').filter(Boolean)
      .map(directory => join(directory.replace(/^"|"$/g, ''), 'node_modules', 'npm', 'bin', 'npm-cli.js')),
  ];
  const cli = candidates.find(path => path && basename(path) === 'npm-cli.js' && existsSync(path));
  if (!cli) throw new Error('Cannot locate npm-cli.js. Install npm with Node.js or start the server using npm start.');
  return { command: process.execPath, args: [cli, ...args] };
}
