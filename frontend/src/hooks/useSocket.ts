import { useEffect, useState } from 'react';
import { getSocket } from '../lib/socket';
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

    // Read the singleton managed by AuthContext
    const s = getSocket();
    if (!s) {
      setSocket(null);
      setConnected(false);
      return;
    }

    setSocket(s);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onConnectError = (err: Error) => {
      if (err.message === 'Authentication required' || err.message === 'Invalid or expired token') {
        console.warn('Socket auth failed:', err.message);
      }
      setConnected(false);
    };

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onConnectError);

    if (s.connected) setConnected(true);

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onConnectError);
      // Don't disconnect — the singleton is managed by AuthContext
    };
  }, [accessToken]);

  return { socket, connected };
}
