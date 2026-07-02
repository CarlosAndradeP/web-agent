import type { AppConfig, ModelInfo, AdminModelInfo, Session, Task, Message, AgentStep, FileEntry, UserPublic, Project, CreditTransaction, NodeProcessInfo, OrchestratorStatusInfo, OrchestratorSessionInfo, OrchestratorStepInfo } from '../types';

const BASE = '/api';

// Lazy reference to authFetch — set by AuthProvider after mount
let _authFetch: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null = null;

export function setAuthFetch(fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): void {
  _authFetch = fn;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('webagent_access_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function getAuthHeadersNoContentType(): Record<string, string> {
  const token = localStorage.getItem('webagent_access_token');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const fetcher = _authFetch ?? fetch;
  const res = await fetcher(`${url}`, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...(options?.headers as Record<string, string> || {}),
    },
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  config: {
    get: () => fetchJSON<AppConfig>(`${BASE}/config`),
    update: (data: Partial<AppConfig>) =>
      fetchJSON<AppConfig>(`${BASE}/config`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },
  models: {
    list: () => fetchJSON<{ models: ModelInfo[] }>(`${BASE}/models`),
  },
  sessions: {
    list: (limit?: number, offset?: number) =>
      fetchJSON<{ sessions: Session[]; total: number; limit: number; offset: number }>(`${BASE}/sessions?limit=${limit ?? 50}&offset=${offset ?? 0}`),
    create: (name: string, model?: string) =>
      fetchJSON<{ session: Session }>(`${BASE}/sessions`, {
        method: 'POST',
        body: JSON.stringify({ name, model }),
      }),
    delete: (id: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/sessions/${id}`, { method: 'DELETE' }),
    messages: (id: string) =>
      fetchJSON<{ messages: Message[] }>(`${BASE}/sessions/${id}/messages`),
    clearMessages: (id: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/sessions/${id}/messages`, { method: 'DELETE' }),
  },
  tasks: {
    list: (limit?: number, offset?: number) =>
      fetchJSON<{ tasks: Task[]; total: number; limit: number; offset: number }>(`${BASE}/tasks?limit=${limit ?? 50}&offset=${offset ?? 0}`),
    create: (data: { sessionId?: string; description: string; model?: string; maxSteps?: number }) =>
      fetchJSON<{ task: Task }>(`${BASE}/tasks`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    get: (id: string) => fetchJSON<{ task: Task }>(`${BASE}/tasks/${id}`),
    cancel: (id: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/tasks/${id}`, {
        method: 'PATCH',
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
        headers: getAuthHeadersNoContentType(),
        body: formData,
      });
      if (!res.ok) throw new Error(`Upload error: ${res.status}`);
      return res.json() as Promise<{ success: boolean; uploaded: string[] }>;
    },
    mkdir: (path: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/files/mkdir`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      }),
    downloadUrl: (path: string) => {
      // No token in URL — use downloadBlob instead for auth
      return `${BASE}/files/download?path=${encodeURIComponent(path)}`;
    },
    downloadZipUrl: (path: string) => {
      return `${BASE}/files/download-zip?path=${encodeURIComponent(path)}`;
    },
    downloadBlob: async (url: string) => {
      const fetcher = _authFetch ?? fetch;
      const token = localStorage.getItem('webagent_access_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetcher(url, { headers });
      if (!res.ok) throw new Error(`Download error: ${res.status}`);
      return res.blob();
    },
    extractZip: async (file: File, destination?: string) => {
      const formData = new FormData();
      formData.append('zipfile', file);
      if (destination) {
        formData.append('destination', destination);
      }
      const res = await fetch(`${BASE}/files/extract-zip`, {
        method: 'POST',
        headers: getAuthHeadersNoContentType(),
        body: formData,
      });
      if (!res.ok) throw new Error(`Extract zip error: ${res.status}`);
      return res.json() as Promise<{ success: boolean; destination: string; extracted: string[] }>;
    },
    listFolders: (path = '.') =>
      fetchJSON<{ folders: { name: string; path: string }[] }>(`${BASE}/files/list-folders?path=${encodeURIComponent(path)}`),
    rename: (oldPath: string, newPath: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/files/rename`, {
        method: 'POST',
        body: JSON.stringify({ oldPath, newPath }),
      }),
    createFile: (path: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/files/create-file`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      }),
  },
  chat: {
    stream: (sessionId: string, model: string, messages: Array<{ role: string; content: string }>, maxSteps?: number, signal?: AbortSignal) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = localStorage.getItem('webagent_access_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return fetch(`${BASE}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId, model, messages, maxSteps }),
        signal,
      });
    },
    compact: (sessionId: string) =>
      fetchJSON<{ success: boolean; summary?: string }>(`${BASE}/chat/compact`, {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      }),
  },
  projects: {
    list: () => fetchJSON<{ projects: Project[] }>(`${BASE}/projects`),
    create: (data: { name: string; folderPath: string; type?: 'static' | 'php' | 'node' }) =>
      fetchJSON<{ project: Project }>(`${BASE}/projects`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    get: (id: string) => fetchJSON<{ project: Project }>(`${BASE}/projects/${id}`),
    delete: (id: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/projects/${id}`, { method: 'DELETE' }),
    start: (id: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/projects/${id}/start`, { method: 'POST' }),
    stop: (id: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/projects/${id}/stop`, { method: 'POST' }),
    promoteNode: (id: string) =>
      fetchJSON<{ project: Project }>(`${BASE}/projects/${id}/promote-node`, { method: 'POST' }),
  },
  admin: {
    users: () => fetchJSON<{ users: UserPublic[] }>(`${BASE}/admin/users`),
    addCredits: (userId: string, amount: number, description?: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/admin/users/${userId}/credits`, {
        method: 'POST',
        body: JSON.stringify({ amount, description }),
      }),
    changeRole: (userId: string, role: 'admin' | 'user') =>
      fetchJSON<{ success: boolean }>(`${BASE}/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    deleteUser: (userId: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/admin/users/${userId}`, { method: 'DELETE' }),
    creditHistory: (userId: string, limit?: number, offset?: number) =>
      fetchJSON<{ history: CreditTransaction[]; balance: number }>(`${BASE}/admin/users/${userId}/credits/history?limit=${limit || 50}&offset=${offset || 0}`),
    stats: () => fetchJSON<{ totalUsers: number; totalProjects: number; totalTasks: number; totalCreditsUsed: number; totalCreditsGranted: number; activeProjects: number; runningTasks: number; totalSteps: number }>(`${BASE}/admin/stats`),
    models: () => fetchJSON<{ models: AdminModelInfo[] }>(`${BASE}/admin/models`),
    updateModel: (modelId: string, data: { enabled?: boolean; costPerStep?: number; displayName?: string | null }) =>
      fetchJSON<{ success: boolean }>(`${BASE}/admin/models`, {
        method: 'PUT',
        body: JSON.stringify({ modelId, ...data }),
      }),
    deleteModelConfig: (modelId: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/admin/models/delete`, {
        method: 'POST',
        body: JSON.stringify({ modelId }),
      }),
    batchUpdateModels: (modelIds: string[], enabled: boolean) =>
      fetchJSON<{ success: boolean; updated: number }>(`${BASE}/admin/models/batch`, {
        method: 'PATCH',
        body: JSON.stringify({ modelIds, enabled }),
      }),
    updateUser: (userId: string, data: { email?: string }) =>
      fetchJSON<{ success: boolean }>(`${BASE}/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    resetPassword: (userId: string, newPassword: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/admin/users/${userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      }),
    nodeProcesses: () =>
      fetchJSON<{ processes: NodeProcessInfo[] }>(`${BASE}/admin/node-processes`),
    stopNodeProcess: (uuid: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/admin/node-processes/${uuid}/stop`, { method: 'POST' }),
    restartNodeProcess: (uuid: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/admin/node-processes/${uuid}/restart`, { method: 'POST' }),
    settings: () =>
      fetchJSON<{ registrationEnabled: boolean }>(`${BASE}/admin/settings`),
    updateSettings: (data: { registrationEnabled?: boolean }) =>
      fetchJSON<{ registrationEnabled: boolean }>(`${BASE}/admin/settings`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  },
  orchestrator: {
    status: () => fetchJSON<OrchestratorStatusInfo>(`${BASE}/orchestrator/status`),
    sessionStatus: (sessionId: string) =>
      fetchJSON<{ session: OrchestratorSessionInfo }>(`${BASE}/orchestrator/${sessionId}/status`),
    start: (data: { sessionId?: string; objective: string; mdFiles?: string[] }) =>
      fetchJSON<{ session: OrchestratorSessionInfo }>(`${BASE}/orchestrator/start`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    stop: (sessionId: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/orchestrator/${sessionId}/stop`, { method: 'POST' }),
    pause: (sessionId: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/orchestrator/${sessionId}/pause`, { method: 'POST' }),
    resume: (sessionId: string) =>
      fetchJSON<{ success: boolean }>(`${BASE}/orchestrator/${sessionId}/resume`, { method: 'POST' }),
    steps: (sessionId: string, limit?: number, offset?: number) =>
      fetchJSON<{ steps: OrchestratorStepInfo[]; total: number }>(`${BASE}/orchestrator/${sessionId}/steps?limit=${limit ?? 50}&offset=${offset ?? 0}`),
    uploadMd: async (sessionId: string, files: File[]) => {
      const formData = new FormData();
      for (const file of files) formData.append('files', file);
      const res = await fetch(`${BASE}/orchestrator/${sessionId}/upload-md`, {
        method: 'POST',
        headers: getAuthHeadersNoContentType(),
        body: formData,
      });
      if (!res.ok) throw new Error(`Upload error: ${res.status}`);
      return res.json() as Promise<{ success: boolean; mdFiles: string[] }>;
    },
  },
};
