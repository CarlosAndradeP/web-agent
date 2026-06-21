import { useState, useEffect, useCallback } from 'react';
import type { FileEntry } from '../types';
import { api } from '../lib/api';

export function useFiles() {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.files.list('.', true);
      setTree(data.tree);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { tree, loading, refresh };
}
