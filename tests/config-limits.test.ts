import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import Database from 'better-sqlite3';
import { schema } from '../src/db/schema.js';
import { ConfigRepository } from '../src/db/repositories/config.js';
import { createConfigRouter } from '../src/api/config.js';

test('legacy step settings always produce a usable chat limit', () => {
  const db = new Database(':memory:');
  db.exec(schema);
  const repo = new ConfigRepository(db);
  try {
    for (const [stored, expected] of [['1000', 500], ['0', 1], ['invalid', 100], ['1.5', 100], ['250', 250]] as const) {
      repo.set('max_steps', stored);
      assert.equal(repo.getPublic().maxSteps, expected);
    }
  } finally { db.close(); }
});

test('config rejects invalid limits without saving any other fields', async t => {
  const db = new Database(':memory:'); db.exec(schema);
  const repo = new ConfigRepository(db);
  repo.set('max_steps', '100');
  const app = express(); app.use(express.json());
  app.use(createConfigRouter(repo, (_req, _res, next) => next()));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); db.close(); });
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const maxSteps of [0, 501, 1.5, '100', null]) {
    const response = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxSteps, workspaceDir: 'must-not-change' }) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /maxSteps/);
    assert.equal(repo.get('max_steps'), '100');
    assert.notEqual(repo.get('workspace_dir'), 'must-not-change');
  }
  const accepted = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"maxSteps":500}' });
  assert.equal(accepted.status, 200);
  assert.equal(repo.getAll().maxSteps, 500);
});
