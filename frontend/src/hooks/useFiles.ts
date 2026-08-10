import { useState, useEffect, useCallback } from 'react';
import type { FileEntry } from '../types';
import { api } from '../lib/api';
import { useSocket } from './useSocket';

export function useFiles(basePath: string = '.') {
  const { socket } = useSocket();
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => {
    setRevision(value => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const load = async () => {
    try {
      const data = await api.files.list(basePath, true, controller.signal);
      setTree(data.tree);
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar os arquivos');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
    };
    void load();
    return () => controller.abort();
  }, [basePath, revision]);

  useEffect(() => {
    if (!socket) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handleChange = ({ path }: { path: string }) => {
      const normalizedBase = basePath === '.' ? '' : `${basePath.replace(/\/$/, '')}/`;
      if (normalizedBase && path !== basePath && !path.startsWith(normalizedBase)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 250);
    };
    socket.on('file:changed', handleChange);
    return () => {
      if (timer) clearTimeout(timer);
      socket.off('file:changed', handleChange);
    };
  }, [basePath, refresh, socket]);

  return { tree, loading, error, refresh };
}
