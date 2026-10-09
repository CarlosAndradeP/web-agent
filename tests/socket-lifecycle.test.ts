import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Server } from 'socket.io';
import { onSocketEvent, connectWithAuth, disconnectSocket } from '../frontend/src/lib/socket.js';

test('socket events subscribed before connection survive authentication reconnects', { timeout: 5000 }, async () => {
  const http = createServer();
  const server = new Server(http);
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  const oldLocation = (globalThis as any).location;
  (globalThis as any).location = new URL(`http://127.0.0.1:${(http.address() as any).port}`);
  const received: string[] = [];
  const tokens: string[] = [];
  const dispose = onSocketEvent('test:notification', value => received.push(value));
  server.on('connection', socket => {
    tokens.push(socket.handshake.auth.token);
    socket.on('test:request', value => socket.emit('test:notification', value));
  });
  try {
    const first = connectWithAuth('first-token');
    await once(first, 'connect');
    assert.equal(connectWithAuth('first-token'), first);
    first.emit('test:request', 'first');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(received, ['first']);
    const renewed = connectWithAuth('renewed-token');
    assert.equal(renewed, first, 'token renewal preserves the socket and subscriptions');
    await once(renewed, 'connect');
    renewed.emit('test:request', 'renewed');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(received, ['first', 'renewed']);
    assert.deepEqual(tokens, ['first-token', 'renewed-token']);
    disconnectSocket();
    const second = connectWithAuth('second-token');
    await once(second, 'connect');
    second.emit('test:request', 'second');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(received, ['first', 'renewed', 'second']);
    dispose();
    second.emit('test:request', 'after-dispose');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(received, ['first', 'renewed', 'second']);
  } finally {
    dispose(); disconnectSocket();
    await new Promise<void>(resolve => server.close(() => resolve()));
    (globalThis as any).location = oldLocation;
  }
});
