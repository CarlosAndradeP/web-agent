import { useState, useEffect, useCallback } from 'react';
import type { FileEntry } from '../types';
import { api } from '../lib/api';

export function useFiles(basePath: string = '.') {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.files.list(basePath, true);
      setTree(data.tree);
    } catch {
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  return { tree, loading, refresh };
}
