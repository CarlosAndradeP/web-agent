import { io, type Socket } from 'socket.io-client';

let socketInstance: Socket | null = null;
const socketListeners = new Set<(socket: Socket | null) => void>();

function notifySocketChange(): void {
  for (const listener of socketListeners) {
    listener(socketInstance);
  }
}

export function getSocket(): Socket | null {
  return socketInstance;
}

export function connectWithAuth(token: string): Socket {
  if (socketInstance) {
    // If already connected with same auth, return existing
    if (socketInstance.connected) return socketInstance;
    // Disconnect stale instance before reconnecting
    socketInstance.disconnect();
  }

  socketInstance = io('/', {
    path: '/socket.io',
    auth: { token },
    autoConnect: false,
  });

  socketInstance.connect();
  notifySocketChange();
  return socketInstance;
}

export function disconnectSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
    notifySocketChange();
  }
}

export function subscribeSocketChange(listener: (socket: Socket | null) => void): () => void {
  socketListeners.add(listener);
  listener(socketInstance);
  return () => {
    socketListeners.delete(listener);
  };
}

/**
 * Subscribe to a socket event using the singleton.
 * Returns a cleanup function that removes the listener.
 * If no socket is connected yet, the listener is deferred until connection.
 */
export function onSocketEvent(event: string, handler: (...args: any[]) => void): () => void {
  let attached: Socket | null = null;
  const unsubscribe = subscribeSocketChange(socket => {
    attached?.off(event, handler);
    attached = socket;
    attached?.on(event, handler);
  });
  return () => {
    unsubscribe();
    attached?.off(event, handler);
    attached = null;
  };
}
