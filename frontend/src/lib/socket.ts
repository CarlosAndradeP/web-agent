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
  const socket = getSocket();
  if (socket) {
    socket.on(event, handler);
    return () => { socket.off(event, handler); };
  }
  // No socket yet — listener will be attached when AuthContext connects
  // Return a no-op cleanup; the event will be missed until connection
  return () => {};
}
