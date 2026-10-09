import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import express from 'express';

const root = await mkdtemp(join(tmpdir(), 'web-agent-regression-'));
process.env.API_BASE_URL = 'http://provider.invalid/v1';
process.env.API_KEY = '';
process.env.AGENT_MAX_RETRIES = '0';
process.env.WORKSPACE_BASE_DIR = root;
const { schema } = await import('../src/db/schema.js');
const { TaskManager } = await import('../src/services/task-manager.js');
const { CompactionService } = await import('../src/services/compaction-service.js');
const { ConfigRepository } = await import('../src/db/repositories/config.js');
const { MessagesRepository } = await import('../src/db/repositories/messages.js');
const { SessionsRepository } = await import('../src/db/repositories/sessions.js');
const { createChatRouter } = await import('../src/api/chat.js');
const { createSessionsRouter } = await import('../src/api/sessions.js');
const { createAuthRouter } = await import('../src/api/auth.js');
const { config } = await import('../src/config.js');
const { ApprovalManager } = await import('../src/services/approval-manager.js');
const { buildToolSet } = await import('../src/agent/tools/index.js');

const db = new Database(':memory:');
db.exec(schema);
db.prepare("INSERT INTO users (id, username, password_hash, credits) VALUES ('owner', 'tester', 'unused', 100)").run();
const credits = { hasCredits: () => true, getCostPerStep: () => 1, deductCredit: () => {} };
const manager = new TaskManager(db, credits as any);
const compaction = new CompactionService(db);
const messages = new MessagesRepository(db);
const sessions = new SessionsRepository(db);
const configRepo = new ConfigRepository(db);
configRepo.set('default_model', 'test-model');
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => { req.user = { userId: 'owner', role: 'user' }; next(); });
app.use('/chat', createChatRouter(db, manager, credits as any, compaction));
app.use('/sessions', createSessionsRouter(db));
app.use('/auth', createAuthRouter(db));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const realFetch = globalThis.fetch;
let scenario = 'stop';
let calls: any[] = [];
let releaseBlocked: (() => void) | undefined;

function response(delta: any, reason: string | null): Response {
  const chunks = [
    { id: 'generation', model: 'test-model', created: 1, choices: [{ index: 0, delta, finish_reason: null }] },
    { id: 'generation', model: 'test-model', created: 1, choices: [{ index: 0, delta: {}, finish_reason: reason }] },
  ];
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}

before(() => {
  globalThis.fetch = async (input, init) => {
    if (!String(input).includes('provider.invalid')) return realFetch(input, init);
    const request = JSON.parse(String(init?.body));
    calls.push(request);
    if (scenario === 'blocked' || (scenario === 'tool-blocked' && calls.length > 1)) await new Promise<void>((resolve, reject) => {
      releaseBlocked = resolve;
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    });
    if (scenario === 'summary-failure') return new Response('Unavailable', { status: 503 });
    if (!request.stream) return new Response(JSON.stringify({ id: 'summary', model: 'test-model', created: 1, choices: [{ index: 0, message: { role: 'assistant', content: 'Summary of older turns' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { headers: { 'Content-Type': 'application/json' } });
    if (scenario.startsWith('tool') && calls.length === 1) return response({ role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'writeFile', arguments: JSON.stringify({ path: 'saved.txt', content: 'saved progress' }) } }] }, 'tool_calls');
    if (scenario === 'tool-failure') return new Response('Unavailable', { status: 503 });
    if (scenario === 'http-failure') return new Response('Unauthorized', { status: 401 });
    if (scenario === 'stream-error') return new Response('data: {"error":{"message":"provider failure","type":"server_error"}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    return response({ role: 'assistant', content: scenario === 'empty' ? '' : 'Final response.' }, scenario === 'length' ? 'length' : 'stop');
  };
});
after(async () => {
  globalThis.fetch = realFetch;
  server.close();
  server.closeAllConnections();
  db.close();
  await rm(root, { recursive: true, force: true });
});

function newSession() {
  const session = sessions.create('Regression', 'test-model');
  db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run('owner', session.id);
  return session.id;
}
async function chat(sessionId: string, maxSteps = 5, content = 'Do the work') {
  return realFetch(`${base}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, model: 'test-model', maxSteps, messages: [{ role: 'user', content }] }) });
}

test('chat validation identifies the rejected field before creating a task', async () => {
  const id = newSession();
  const valid = { sessionId: id, model: 'test-model', maxSteps: 5, messages: [{ role: 'user', content: 'Hello' }] };
  for (const [change, field] of [[{ maxSteps: 501 }, 'maxSteps'], [{ model: '' }, 'model'], [{ messages: [] }, 'messages'], [{ sessionId: 123 }, 'sessionId']] as const) {
    const response = await realFetch(`${base}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...valid, ...change }) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, new RegExp(field));
  }
  assert.equal(manager.getTasksBySession(id).length, 0);
});

for (const failure of ['http-failure', 'stream-error', 'length', 'empty']) {
  test(`${failure} never produces a successful finish`, async () => {
    scenario = failure; calls = [];
    const id = newSession();
    const output = await (await chat(id)).text();
    assert.match(output, /"type":"error"/);
    assert.doesNotMatch(output, /"type":"finish"/);
    assert.equal(manager.getTasksBySession(id)[0].status, 'failed');
    assert.match(messages.findBySession(id).at(-1)!.content!, /Work is incomplete/);
  });
}
test('completed tools survive API failure and are supplied exactly once on continuation', async () => {
  scenario = 'tool-failure'; calls = [];
  const id = newSession();
  const output = await (await chat(id)).text();
  assert.match(output, /"type":"error"/);
  assert.equal(await readFile(join(root, 'tester', 'saved.txt'), 'utf8'), 'saved progress');
  const context = compaction.getConversationContext(id);
  assert.equal(context.filter(message => message.role === 'tool').length, 1);
  assert.match(JSON.stringify(context), /Work is incomplete/);
  scenario = 'stop'; calls = [];
  const continued = await (await chat(id, 5, 'Continue from saved progress')).text();
  assert.match(continued, /"type":"finish"/);
  assert.equal(calls[0].messages.filter((message: any) => message.role === 'tool').length, 1);
});
test('normal multiple-step completion does not duplicate the SDK transcript', async () => {
  scenario = 'tool-stop'; calls = [];
  const id = newSession();
  const output = await (await chat(id)).text();
  assert.match(output, /"type":"finish"/);
  assert.equal(compaction.getConversationContext(id).filter(message => message.role === 'tool').length, 1);
});
test('step exhaustion keeps tool progress and fails instead of claiming completion', async () => {
  scenario = 'tool-stop'; calls = [];
  const id = newSession();
  const output = await (await chat(id, 1)).text();
  assert.match(output, /step limit/);
  assert.doesNotMatch(output, /"type":"finish"/);
  assert.equal(manager.getTasksBySession(id)[0].status, 'failed');
  assert.equal(compaction.getConversationContext(id).filter(message => message.role === 'tool').length, 1);
});
test('failed compaction preserves original history and latest request', async () => {
  scenario = 'summary-failure'; calls = [];
  const id = newSession();
  for (let i = 0; i < 8; i++) messages.create(id, 'user', `Request ${i}`);
  await assert.rejects(compaction.compactSession(id));
  assert.equal(messages.countActive(id), 8);
  assert.equal(sessions.getSummary(id), null);
});
test('clear removes both messages and previous compaction summary', async () => {
  const id = newSession();
  messages.create(id, 'user', 'Old request'); sessions.updateSummary(id, 'Old objective');
  assert.equal((await realFetch(`${base}/sessions/${id}/messages`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(compaction.getConversationContext(id), []);
});
test('successful compaction keeps the latest six turns verbatim', async () => {
  scenario = 'summary-success'; calls = [];
  const id = newSession();
  for (let i = 0; i < 9; i++) messages.create(id, i % 2 ? 'assistant' : 'user', `Turn ${i}`);
  await compaction.compactSession(id);
  assert.equal(messages.countActive(id), 6);
  const context = compaction.getConversationContext(id);
  assert.equal(context[0].role, 'system');
  assert.equal(context.at(-1)!.content, 'Turn 8');
  assert.equal(context[1].content, 'Turn 3');
});
test('provider-specific transcript metadata survives subsequent turns', () => {
  const id = newSession();
  const transcript = [{ role: 'assistant', content: 'Done', providerOptions: { compatible: { reasoning: 'signed reasoning' } } }];
  messages.create(id, 'assistant', 'Done', null, null, null, JSON.stringify(transcript));
  assert.deepEqual(compaction.getConversationContext(id), transcript);
});
test('unowned sessions and malformed input are rejected', async () => {
  const id = sessions.create('Orphan', 'test-model').id;
  assert.equal((await realFetch(`${base}/sessions/${id}/messages`)).status, 403);
  assert.equal((await chat(id)).status, 403);
  assert.equal((await chat('missing-session')).status, 404);
  assert.equal((await chat(newSession(), -1)).status, 400);
});
test('concurrent chat requests cannot interleave one session history', async () => {
  scenario = 'blocked'; calls = [];
  const id = newSession();
  const first = await chat(id);
  const compactResult = await realFetch(`${base}/chat/compact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: id }) });
  assert.equal(compactResult.status, 409);
  assert.equal((await chat(id)).status, 409);
  releaseBlocked?.();
  assert.match(await first.text(), /"type":"finish"/);
});
test('registration credits are granted once', async () => {
  const result = await realFetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'newuser', password: 'test-password', email: 'newuser@example.com' }) });
  assert.equal(result.status, 201);
  const data = await result.json();
  assert.equal(data.user.credits, config.initialCredits);
});
test('cancellation is terminal and never overwritten with completion', async () => {
  scenario = 'blocked'; calls = [];
  const id = newSession();
  const first = await chat(id);
  const task = manager.getTasksBySession(id)[0];
  manager.cancelTask(task.id);
  const output = await first.text();
  assert.match(output, /"type":"cancelled"/);
  assert.doesNotMatch(output, /"type":"finish"/);
  assert.equal(manager.getTask(task.id)?.status, 'cancelled');
  assert.match(messages.findBySession(id).at(-1)!.content!, /Task cancelled/);
});
test('a cancelled approval never executes its pending file write', async () => {
  const approvals = new ApprovalManager();
  const controller = new AbortController();
  const tools = buildToolSet({ workspaceDir: root, approvalMode: 'all', approvalTools: [], approvalManager: approvals, userId: 'owner', abortSignal: controller.signal });
  const pending = tools.writeFile.execute({ path: 'must-not-exist.txt', content: 'cancelled' }, { toolCallId: 'cancel-test', messages: [], abortSignal: controller.signal });
  controller.abort();
  const result = await pending;
  assert.equal(result.success, false);
  await assert.rejects(readFile(join(root, 'must-not-exist.txt')));
});
test('tool checkpoints are durable while the next API step is still pending', { timeout: 5000 }, async () => {
  scenario = 'tool-blocked'; calls = [];
  const id = newSession();
  const first = await chat(id);
  while (calls.length < 2) await new Promise(resolve => setTimeout(resolve, 10));
  // Wait for the router to consume the preceding step checkpoint.
  while (!compaction.getConversationContext(id).some(message => message.role === 'tool')) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(manager.getTasksBySession(id)[0].status, 'running');
  assert.equal(compaction.getConversationContext(id).filter(message => message.role === 'tool').length, 1);
  manager.cancelTask(manager.getTasksBySession(id)[0].id);
  assert.match(await first.text(), /"type":"cancelled"/);
});
