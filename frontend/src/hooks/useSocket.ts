import { useEffect, useState } from 'react';
import { subscribeSocketChange } from '../lib/socket';
import type { Socket } from 'socket.io-client';
import { useAuth } from '../contexts/AuthContext';

/**
 * Provides access to the singleton Socket.IO connection managed by AuthContext.
 * Does NOT create a new connection — only reads connection state from the existing singleton.
 */
export function useSocket() {
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const { accessToken } = useAuth();

  useEffect(() => {
    if (!accessToken) {
      setSocket(null);
      setConnected(false);
      return;
    }

    return subscribeSocketChange(s => {
      setSocket(s);
      setConnected(!!s?.connected);
    });
  }, [accessToken]);

  useEffect(() => {
    if (!socket) {
      setConnected(false);
      return;
    }

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onConnectError = (err: Error) => {
      if (err.message === 'Authentication required' || err.message === 'Invalid or expired token') {
        console.warn('Socket auth failed:', err.message);
      }
      setConnected(false);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      // Don't disconnect — the singleton is managed by AuthContext
    };
  }, [socket]);

  return { socket, connected };
}
