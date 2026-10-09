import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { resolveModels, invalidateModelCache } from '../src/services/model-resolver.js';
import { writeSse } from '../src/lib/sse.js';
import { loadHighlight } from '../frontend/src/lib/highlight.js';

test('concurrent catalog requests share one upstream fetch and retain separate credentials', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; invalidateModelCache(); });
  invalidateModelCache();
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return Response.json({ data: [{ id: new Headers(options?.headers).get('Authorization') || 'anonymous' }] });
  };
  const models = await Promise.all(Array.from({ length: 20 }, () => resolveModels('http://catalog.invalid/v1/', 'one')));
  assert.equal(calls, 1);
  assert.ok(models.every(result => result[0].id === 'Bearer one'));
  await resolveModels('http://catalog.invalid/v1', 'two');
  assert.equal(calls, 2);
  assert.equal((await resolveModels('http://catalog.invalid/v1', 'one'))[0].id, 'Bearer one');
  assert.equal(calls, 2);
});

test('invalidation prevents an old catalog response replacing refreshed models', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; invalidateModelCache(); });
  invalidateModelCache();
  let release!: (response: Response) => void;
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) return new Promise<Response>(resolve => { release = resolve; });
    return Response.json({ data: [{ id: 'new' }] });
  };
  const old = resolveModels('http://catalog.invalid');
  invalidateModelCache();
  assert.equal((await resolveModels('http://catalog.invalid'))[0].id, 'new');
  release(Response.json({ data: [{ id: 'old' }] }));
  await old;
  assert.equal((await resolveModels('http://catalog.invalid'))[0].id, 'new');
  assert.equal(calls, 2);
});

test('permanent catalog errors are not retried and fallback is briefly cached', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; invalidateModelCache(); });
  invalidateModelCache();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('Unauthorized', { status: 401 }); };
  const fallback = await resolveModels('http://catalog.invalid');
  assert.ok(fallback.length > 0);
  assert.deepEqual(await resolveModels('http://catalog.invalid'), fallback);
  assert.equal(calls, 1);
});

class SlowResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writes: string[] = [];
  write(chunk: string) { this.writes.push(chunk); return false; }
}

test('SSE waits for a slow client and removes temporary listeners after drain', async () => {
  const response = new SlowResponse();
  let completed = false;
  const pending = writeSse(response as unknown as ServerResponse, { type: 'text-delta', content: 'hello' }).then(result => { completed = true; return result; });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(response.writes[0], 'data: {"type":"text-delta","content":"hello"}\n\n');
  response.emit('drain');
  assert.equal(await pending, true);
  assert.equal(response.listenerCount('close'), 0);
  assert.equal(response.listenerCount('error'), 0);
});

test('SSE stops waiting when a slow client disconnects', async () => {
  const response = new SlowResponse();
  const pending = writeSse(response as unknown as ServerResponse, { type: 'task-start' });
  response.destroyed = true;
  response.emit('close');
  assert.equal(await pending, false);
  assert.equal(await writeSse(response as unknown as ServerResponse, {}), false);
  assert.equal(response.writes.length, 1);
  assert.equal(response.listenerCount('drain'), 0);
});

test('small highlighter handles web languages and uncommon languages still have a fallback', async () => {
  const javascript = await loadHighlight('javascript');
  assert.ok(javascript.getLanguage('typescript'));
  assert.ok(javascript.getLanguage('php'));
  assert.ok(javascript.getLanguage('css'));
  assert.match(javascript.highlight('const answer = 42;', { language: 'javascript' }).value, /hljs-keyword/);
  const uncommon = await loadHighlight('abnf');
  assert.ok(uncommon.getLanguage('abnf'));
});
