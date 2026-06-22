import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { Project } from '../types';

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.projects.list();
      setProjects(data.projects);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createProject = useCallback(async (name: string, folderPath: string, type: 'static' | 'php' | 'node' = 'static') => {
    const data = await api.projects.create({ name, folderPath, type });
    await refresh();
    return data.project;
  }, [refresh]);

  const deleteProject = useCallback(async (id: string) => {
    await api.projects.delete(id);
    await refresh();
  }, [refresh]);

  return { projects, loading, refresh, createProject, deleteProject };
}
