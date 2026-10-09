import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from 'ai';
import { createProvider } from '../src/agent/provider.js';

function completion(): Response {
  return Response.json({
    id: 'test', model: 'test-model', created: 1,
    choices: [{ index: 0, message: { role: 'assistant', content: 'Done' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

test('provider waits for Retry-After before its next HTTP attempt', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  let attempts = 0;
  let firstAt = 0;
  let secondAt = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts === 1) {
      firstAt = Date.now();
      return Response.json({ error: { message: 'capacity exhausted' } }, { status: 429, headers: { 'Retry-After': '0.1' } });
    }
    secondAt = Date.now();
    return completion();
  };
  const model = createProvider('http://test.invalid/v1', '').chatModel('test-model');
  await assert.rejects(generateText({ model, prompt: 'Hello', maxRetries: 0 }));
  assert.equal((await generateText({ model, prompt: 'Hello', maxRetries: 0 })).text, 'Done');
  assert.ok(secondAt - firstAt >= 95);
});

test('65-second proxy cooldown can be cancelled without sending another request', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return Response.json({ error: { message: 'capacity exhausted' } }, { status: 429, headers: { 'Retry-After': '65' } });
  };
  const model = createProvider('http://test.invalid/v1', '').chatModel('test-model');
  await assert.rejects(generateText({ model, prompt: 'Hello', maxRetries: 0 }));
  await assert.rejects(generateText({ model, prompt: 'Hello', maxRetries: 0, abortSignal: AbortSignal.timeout(30) }));
  assert.equal(attempts, 1);
});
