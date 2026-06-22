import type { AppConfig, ModelInfo, Session, Task, Message, AgentStep, FileEntry } from '../types';

const BASE = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  config: {
    get: () => fetchJSON<AppConfig>(`${BASE}/config`),
    update: (data: Partial<AppConfig>) =>
      fetchJSON<AppConfig>(`${BASE}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
  },
  models: {
    list: () => fetchJSON<{ models: ModelInfo[] }>(`${BASE}/models`),
  },
  sessions: {
    list: () => fetchJSON<{ sessions: Session[] }>(`${BASE}/sessions`),
    create: (name: string, model?: string) =>
      fetchJSON<{ session: Session }>(`${BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, model }),
      }),
    delete: (id: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/sessions/${id}`, { method: 'DELETE' }),
    messages: (id: string) =>
      fetchJSON<{ messages: Message[] }>(`${BASE}/sessions/${id}/messages`),
  },
  tasks: {
    list: () => fetchJSON<{ tasks: Task[] }>(`${BASE}/tasks`),
    create: (data: { sessionId?: string; description: string; model?: string; maxSteps?: number }) =>
      fetchJSON<{ task: Task }>(`${BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    get: (id: string) => fetchJSON<{ task: Task }>(`${BASE}/tasks/${id}`),
    cancel: (id: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      }),
    steps: (id: string) =>
      fetchJSON<{ steps: AgentStep[] }>(`${BASE}/tasks/${id}/steps`),
  },
  files: {
    list: (path = '.', recursive = false) =>
      fetchJSON<{ tree: FileEntry[] }>(`${BASE}/files?path=${encodeURIComponent(path)}&recursive=${recursive}`),
    content: (path: string) =>
      fetchJSON<{ path: string; content: string }>(`${BASE}/files/content?path=${encodeURIComponent(path)}`),
    write: (path: string, content: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
      }),
    delete: (path: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
    upload: async (files: File[], destination?: string) => {
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }
      if (destination) {
        formData.append('destination', destination);
      }
      const res = await fetch(`${BASE}/files/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(`Upload error: ${res.status}`);
      return res.json() as Promise<{ success: boolean; uploaded: string[] }>;
    },
    mkdir: (path: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/files/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }),
    downloadUrl: (path: string) => `${BASE}/files/download?path=${encodeURIComponent(path)}`,
  },
  chat: {
    stream: (sessionId: string, model: string, messages: Array<{ role: string; content: string }>, maxSteps?: number) => {
      return fetch(`${BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, model, messages, maxSteps }),
      });
    },
  },
};
