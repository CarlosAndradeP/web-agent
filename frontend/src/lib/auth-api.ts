export interface UserPublic {
  id: string;
  username: string;
  email: string | null;
  role: 'admin' | 'user';
  credits: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: UserPublic;
}

const BASE = '/api/auth';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `${res.status}`);
  }
  return res.json();
}

export const authApi = {
  login: (username: string, password: string) =>
    fetchJSON<AuthResponse>(`${BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),

  register: (username: string, password: string, email?: string) =>
    fetchJSON<AuthResponse>(`${BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, email }),
    }),

  refresh: (refreshToken: string) =>
    fetchJSON<AuthResponse>(`${BASE}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }),

  me: (accessToken: string) =>
    fetchJSON<{ user: UserPublic }>(`${BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),

  logout: (accessToken?: string) =>
    fetchJSON<{ success: boolean }>(`${BASE}/logout`, {
      method: 'POST',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    }),
};
