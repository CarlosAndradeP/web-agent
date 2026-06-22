import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { Session } from '../types';

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.sessions.list();
      setSessions(data.sessions);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createSession = useCallback(async (name: string, model?: string) => {
    const data = await api.sessions.create(name, model);
    await refresh();
    return data.session;
  }, [refresh]);

  const deleteSession = useCallback(async (id: string) => {
    await api.sessions.delete(id);
    await refresh();
  }, [refresh]);

  return { sessions, loading, refresh, createSession, deleteSession };
}
