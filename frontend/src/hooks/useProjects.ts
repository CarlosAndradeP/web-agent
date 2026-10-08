import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { onSocketEvent } from '../lib/socket';
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

  // Listen for node-detected events on the singleton socket
  useEffect(() => {
    const handler = (data: { folderPath: string; username: string }) => {
      setProjects(prev => prev.map(p => {
        if (p.type === 'static' && p.folderPath === data.folderPath) {
          return { ...p, nodeReady: true };
        }
        return p;
      }));
    };

    return onSocketEvent('project:node-detected', handler);
  }, []);

  const createProject = useCallback(async (name: string, folderPath: string, type?: 'static' | 'php' | 'node') => {
    const data = await api.projects.create({ name, folderPath, type });
    await refresh();
    return data.project;
  }, [refresh]);

  const deleteProject = useCallback(async (id: string) => {
    await api.projects.delete(id);
    await refresh();
  }, [refresh]);

  const startProject = useCallback(async (id: string) => {
    await api.projects.start(id);
    await refresh();
  }, [refresh]);

  const stopProject = useCallback(async (id: string) => {
    await api.projects.stop(id);
    await refresh();
  }, [refresh]);

  const promoteNode = useCallback(async (id: string) => {
    const data = await api.projects.promoteNode(id);
    await refresh();
    return data.project;
  }, [refresh]);

  return { projects, loading, refresh, createProject, deleteProject, startProject, stopProject, promoteNode };
}
