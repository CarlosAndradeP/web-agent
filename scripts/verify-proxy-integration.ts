// Run: node --import tsx scripts/verify-proxy-integration.ts ../Claude-api
// Uses only temporary keys and a local upstream; no inference quota is consumed.
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ToolLoopAgent, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { createProvider } from '../src/agent/provider.js';
import { assertAgentCompleted } from '../src/agent/completion.js';

const proxyProject = resolve(process.argv[2] ?? '../Claude-api');
const directory = await mkdtemp(join(tmpdir(), 'web-agent-proxy-integration-'));
const servers: Server[] = [];
const requests: any[] = [];
let mode = 'tools';
let writes = 0;

async function listen(server: Server): Promise<string> {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

try {
  const upstreamUrl = await listen(createServer(async (req, res) => {
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const body = JSON.parse(Buffer.concat(buffers).toString());
    requests.push(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const hasResult = body.messages.some((message: any) => message.role === 'tool');
    const delta = mode === 'tools' && !hasResult
      ? { role: 'assistant', tool_calls: [{ index: 0, id: 'write-1', type: 'function', function: { name: 'writeFile', arguments: '{"path":"index.html","content":"hello"}' } }] }
      : { role: 'assistant', content: 'Project created.' };
    const send = (delta: any, reason: string | null) => res.write(`data: ${JSON.stringify({ id: 'test', model: 'test-model', created: 1, choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`);
    send(delta, null);
    if (mode === 'truncated') {
      setTimeout(() => res.destroy(), 20);
      return;
    }
    send({}, hasResult ? 'stop' : 'tool_calls');
    res.end('data: [DONE]\n\n');
  }));
  process.env.DATA_DIR = directory;
  process.env.UPSTREAM_ORIGIN = upstreamUrl;
  await writeFile(join(directory, 'keys.json'), JSON.stringify([{ id: 'test', key: 'local-test-only', name: 'Integration fixture', role: 'all' }]));
  const require = createRequire(import.meta.url);
  const { createProxyApp } = require(join(proxyProject, 'server.js'));
  const proxyUrl = await listen(createServer(createProxyApp()));
  const model = createProvider(`${proxyUrl}/v1`, '', 'main').chatModel('test-model');
  const agent = new ToolLoopAgent({
    model, maxRetries: 0, stopWhen: stepCountIs(3),
    tools: {
      writeFile: tool({
        description: 'Write a file', inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: async input => { writes++; return { path: input.path, success: true }; },
      }),
    },
  });
  const stream = await agent.stream({ prompt: 'Create a page' });
  for await (const _chunk of stream.fullStream) { /* consume exactly as TaskManager does */ }
  assertAgentCompleted(await stream.finishReason, await stream.text);
  assert.equal(writes, 1);
  assert.equal(requests.length, 2);
  assert.ok(requests[1].messages.some((message: any) => message.role === 'tool' && message.tool_call_id === 'write-1'));
  console.log('PASS: Web Agent SDK → Claude-api → upstream → tool result → final response');

  mode = 'truncated';
  const broken = await agent.stream({ prompt: 'Create another page' });
  let errored = false;
  try {
    for await (const chunk of broken.fullStream) if (chunk.type === 'error') errored = true;
  } catch {
    errored = true;
  }
  assert.ok(errored, 'truncated proxy stream must reach the SDK as an error');
  console.log('PASS: Interrupted proxy stream reaches Web Agent as an error');
} finally {
  for (const server of servers.reverse()) {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
  await new Promise(resolve => setTimeout(resolve, 600));
  await rm(directory, { recursive: true, force: true });
}
