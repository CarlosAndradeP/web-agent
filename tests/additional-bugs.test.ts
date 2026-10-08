import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import Database from 'better-sqlite3';
import { schema } from '../src/db/schema.js';
import { migrate } from '../src/db/migrate.js';
import { createAuthRouter } from '../src/api/auth.js';
import { UsersRepository } from '../src/db/repositories/users.js';
import { CreditsRepository } from '../src/db/repositories/credits.js';
import { ConfigRepository } from '../src/db/repositories/config.js';
import { DailyCreditBonus } from '../src/services/daily-credit-bonus.js';
import { config } from '../src/config.js';
import { signRefreshToken } from '../src/lib/jwt.js';
import { ProjectRouter } from '../src/services/project-router.js';
import { EventEmitter } from 'node:events';
import { OrchestratorRunner } from '../src/orchestrator/orchestrator-runner.js';
import { OrchestratorSessionsRepository, OrchestratorTasksRepository } from '../src/db/repositories/orchestrator.js';
import { ProjectsRepository } from '../src/db/repositories/projects.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { npmCommand } from '../src/lib/npm-command.js';
import { OrchestratorManager } from '../src/orchestrator/orchestrator-manager.js';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';

function database() {
  const db = new Database(':memory:');
  db.exec(schema);
  return db;
}

test('refresh tokens issued within the same second are distinct', () => {
  assert.notEqual(signRefreshToken({ userId: 'same-user' }), signRefreshToken({ userId: 'same-user' }));
});

test('rotation rejects a consumed token even when another login session exists', async t => {
  const db = database();
  new UsersRepository(db).create('rotationuser', 'test-password', 'user', 0);
  const app = express(); app.use(express.json()); app.use(createAuthRouter(db));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); db.close(); });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (path: string, body: any) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const first = await (await post('/login', { username: 'rotationuser', password: 'test-password' })).json();
  await post('/login', { username: 'rotationuser', password: 'test-password' });
  assert.equal((await post('/refresh', { refreshToken: first.refreshToken })).status, 200);
  assert.equal((await post('/refresh', { refreshToken: first.refreshToken })).status, 401);
});

test('migration preserves an explicit custom approval configuration across restarts', () => {
  const db = database();
  try {
    const repo = new ConfigRepository(db);
    repo.set('approval_mode', 'custom');
    migrate(db); migrate(db);
    assert.equal(repo.get('approval_mode'), 'custom');
  } finally { db.close(); }
});

test('daily bonus failure rolls back all balances and the period marker', async () => {
  const db = database();
  const users = new UsersRepository(db);
  const first = users.create('bonus-first', 'test-password', 'user', 0);
  const second = users.create('bonus-second', 'test-password', 'user', 0);
  db.prepare('UPDATE users SET created_at = ? WHERE id IN (?, ?)').run(new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(), first.id, second.id);
  const repo = new ConfigRepository(db);
  const oldMarker = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  repo.set('daily_credit_bonus_last_grant_at', oldMarker);
  const credits = new CreditsRepository(db);
  const originalAdd = credits.add.bind(credits);
  let failing = true;
  credits.add = (...args: Parameters<typeof credits.add>) => {
    if (failing && args[0] === second.id) throw new Error('Simulated storage failure');
    return originalAdd(...args);
  };
  const emitted: unknown[] = [];
  const io = { to: () => ({ emit: (...args: unknown[]) => emitted.push(args) }) };
  const service = new DailyCreditBonus(db, repo, credits, users, io as any);
  const previousBonus = config.dailyBonusCredits;
  config.dailyBonusCredits = 2;
  try {
    await (service as any).checkAndGrant().catch(() => {});
    assert.equal(credits.getBalance(first.id), 0);
    assert.equal(credits.getBalance(second.id), 0);
    assert.equal(repo.get('daily_credit_bonus_last_grant_at'), oldMarker);
    assert.equal(emitted.length, 0);
    failing = false;
    await (service as any).checkAndGrant();
    await (service as any).checkAndGrant();
    assert.equal(credits.getBalance(first.id), 2);
    assert.equal(credits.getBalance(second.id), 2);
    assert.equal(emitted.length, 2);
  } finally { config.dailyBonusCredits = previousBonus; db.close(); }
});

test('credit deductions reject negative and fractional values without changing the balance', () => {
  const db = database();
  try {
    const user = new UsersRepository(db).create('credit-user', 'test-password', 'user', 10);
    const credits = new CreditsRepository(db);
    for (const amount of [-5, 0, 0.5, NaN, Infinity]) assert.throws(() => credits.deduct(user.id, amount, 'consumption'));
    assert.equal(credits.getBalance(user.id), 10);
  } finally { db.close(); }
});

test('a child that ignores SIGTERM receives SIGKILL after the grace period', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const router = Object.create(ProjectRouter.prototype) as ProjectRouter;
  const child = new EventEmitter() as any;
  child.exitCode = null; child.signalCode = null; child.killed = false;
  const signals: string[] = [];
  child.kill = (signal: string) => { child.killed = true; signals.push(signal); return true; };
  (router as any).terminateProcess(child, 'test-project', 'test');
  t.mock.timers.tick(5000);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

function orchestrator(db: Database.Database) {
  return new OrchestratorRunner(db, { hasCredits: () => true } as any, {} as any, new ProjectsRepository(db), new UsersRepository(db));
}

test('resuming a paused orchestrator waits for its previous workflow to drain', async () => {
  const db = database();
  const session = new OrchestratorSessionsRepository(db).create(null, undefined, 'test objective', null);
  const runner = orchestrator(db);
  let calls = 0;
  let finishFirst: (() => void) | undefined;
  let finishSecond: (() => void) | undefined;
  (runner as any).runPhasedWorkflow = () => {
    calls++;
    return new Promise<void>(resolve => { if (calls === 1) finishFirst = resolve; else finishSecond = resolve; });
  };
  let resumed: Promise<void> | undefined;
  try {
    await runner.start(session.id);
    runner.pause(session.id);
    resumed = runner.resume(session.id);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1, 'Old workflow is still finishing; a second one must not start');
    finishFirst!();
    await resumed;
    assert.equal(calls, 2);
  } finally {
    finishFirst?.();
    await resumed;
    runner.shutdown();
    finishSecond?.();
    await (runner as any).waitForIdle?.();
    db.close();
  }
});

test('restart recovery returns orphan running orchestrator tasks to pending', async () => {
  const db = database();
  const session = new OrchestratorSessionsRepository(db).create(null, undefined, 'recover work', null);
  const tasks = new OrchestratorTasksRepository(db);
  const task = tasks.create(session.id, { name: 'interrupted', description: 'unfinished work', role: 'programador', stepNumber: 1 });
  tasks.updateStatus(task.id, 'running');
  const runner = orchestrator(db);
  let pendingIds: string[] = [];
  (runner as any).runPhasedWorkflow = async () => { pendingIds = tasks.findPending(session.id).map(item => item.id); };
  try {
    await runner.resume(session.id);
    assert.deepEqual(pendingIds, [task.id]);
  } finally { runner.shutdown(); db.close(); }
});

test('npm can be executed without a shell on this host', async () => {
  const execution = npmCommand(['--version']);
  const { stdout } = await promisify(execFile)(execution.command, execution.args, { timeout: 10000 });
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('editing package.json changes the entry point used on the next start', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-entry-regression-'));
  const router = Object.create(ProjectRouter.prototype) as ProjectRouter;
  try {
    await writeFile(join(root, 'first.js'), "console.log('first')");
    await writeFile(join(root, 'second.js'), "console.log('second')");
    const run = async () => {
      const child = (router as any).spawnNodeProject(root, 9123, 'entry-test');
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      const [code] = await once(child, 'close');
      assert.equal(code, 0);
      return output.trim();
    };
    await writeFile(join(root, 'package.json'), JSON.stringify({ main: 'first.js' }));
    assert.equal(await run(), 'first');
    await writeFile(join(root, 'package.json'), JSON.stringify({ main: 'second.js' }));
    assert.equal(await run(), 'second');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('orchestrator recovery honors autoRecover=false', async () => {
  const db = database();
  const repo = new OrchestratorSessionsRepository(db);
  const session = repo.create(null, undefined, 'manual recovery only', null);
  repo.updateStatus(session.id, 'running');
  db.prepare('UPDATE orchestrator_sessions SET auto_recover = 0 WHERE id = ?').run(session.id);
  const manager = new OrchestratorManager(db, {} as any, {} as any, new ProjectsRepository(db), new UsersRepository(db));
  let created = 0;
  (manager as any).createRunner = () => { created++; throw new Error('Must not create a runner for this session'); };
  try {
    await manager.recoverSessions();
    assert.equal(created, 0);
    assert.equal(repo.findById(session.id)?.status, 'paused');
  } finally { manager.shutdownAll(); db.close(); }
});

test('stopping during an API retry prevents another request after controller cleanup', async () => {
  const db = database();
  const session = new OrchestratorSessionsRepository(db).create(null, undefined, 'stop retry', null);
  const runner = orchestrator(db);
  Object.assign(runner, { running: true, currentSessionId: session.id, abortController: new AbortController() });
  let calls = 0;
  (runner as any).sleep = async () => runner.stop(session.id);
  try {
    await assert.rejects((runner as any).callWithRetry(async () => {
      calls++;
      if (calls === 1) throw new Error('temporary network failure');
      return 'must not run';
    }), /Aborted/);
    assert.equal(calls, 1);
  } finally { runner.shutdown(); db.close(); }
});

test('Node project HTML injection preserves compressed upstream responses', async () => {
  const html = '<html><head><title>Project</title></head><body>Working</body></html>';
  const compressed = gzipSync(html);
  const upstream = createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: live\n\n');
      return; // SSE must reach the client before the upstream stream ends.
    }
    if (req.url === '/data') {
      const data = gzipSync(JSON.stringify({ working: true }));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': data.length });
      res.end(data);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip', 'content-length': compressed.length });
    res.end(compressed);
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const router = Object.create(ProjectRouter.prototype) as ProjectRouter;
  const middleware = (router as any).createNodeProxy((upstream.address() as any).port, 'test-project');
  (router as any).activeProjects = new Map([['test-project', { project: { type: 'node', uuid: 'test-project' }, middleware }]]);
  const app = express(); app.use('/p', router.middleware());
  const downstream = app.listen(0, '127.0.0.1'); await once(downstream, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${(downstream.address() as any).port}/p/test-project/`, { signal: AbortSignal.timeout(3000) });
    const output = await response.text();
    assert.match(output, /<base href="\/p\/test-project\/">/);
    assert.match(output, /<body>Working<\/body>/);
    assert.equal(response.headers.get('content-encoding'), null);
    const base = `http://127.0.0.1:${(downstream.address() as any).port}/p/test-project/`;
    const json = await fetch(base + 'data', { signal: AbortSignal.timeout(3000) });
    assert.deepEqual(await json.json(), { working: true });
    assert.equal(json.headers.get('content-encoding'), 'gzip');
    const head = await fetch(base, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    assert.equal(await head.text(), '');
    const events = await fetch(base + 'events', { signal: AbortSignal.timeout(3000) });
    const reader = events.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: live\n\n');
    await reader.cancel();
  } finally {
    middleware.close?.();
    upstream.close(); upstream.closeAllConnections();
    downstream.close(); downstream.closeAllConnections();
  }
});

test('a stopped workflow keeps its idle status when the pending API call fails', async () => {
  const db = database();
  const repo = new OrchestratorSessionsRepository(db);
  const session = repo.create(null, undefined, 'stop workflow', null);
  const runner = orchestrator(db);
  (runner as any).createPlan = async () => {
    runner.stop(session.id);
    throw new Error('Aborted pending request');
  };
  try {
    await runner.start(session.id);
    await (runner as any).waitForIdle();
    assert.equal(repo.findById(session.id)?.status, 'idle');
  } finally { runner.shutdown(); db.close(); }
});
