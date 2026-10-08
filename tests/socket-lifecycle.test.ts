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
  const dispose = onSocketEvent('test:notification', value => received.push(value));
  server.on('connection', socket => { socket.on('test:request', value => socket.emit('test:notification', value)); });
  try {
    const first = connectWithAuth('first-token');
    await once(first, 'connect');
    first.emit('test:request', 'first');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(received, ['first']);
    disconnectSocket();
    const second = connectWithAuth('second-token');
    await once(second, 'connect');
    second.emit('test:request', 'second');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(received, ['first', 'second']);
    dispose();
    second.emit('test:request', 'after-dispose');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(received, ['first', 'second']);
  } finally {
    dispose(); disconnectSocket();
    await new Promise<void>(resolve => server.close(() => resolve()));
    (globalThis as any).location = oldLocation;
  }
});
