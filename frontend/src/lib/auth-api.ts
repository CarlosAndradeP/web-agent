export interface UserPublic {
  id: string;
  username: string;
  email: string | null;
  role: 'admin' | 'user';
  credits: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  amount: number;
  balanceAfter: number;
  type: 'purchase' | 'consumption' | 'refund' | 'bonus';
  description: string | null;
  taskId: string | null;
  createdAt: string;
}

export interface PixPayment {
  id: string;
  userId: string;
  providerPaymentId: string | null;
  status: string;
  credits: number;
  amountBrl: number;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  creditedAt: string | null;
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

  register: (username: string, password: string, email: string) =>
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

  changePassword: (currentPassword: string, newPassword: string, accessToken: string) =>
    fetchJSON<{ success: boolean }>(`${BASE}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  creditHistory: (accessToken: string, limit?: number, offset?: number) =>
    fetchJSON<{ history: CreditTransaction[]; balance: number }>(`${BASE}/credits/history?limit=${limit || 50}&offset=${offset || 0}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),

  paymentConfig: (accessToken: string) =>
    fetchJSON<{ pixEnabled: boolean; creditPriceBrl: number }>('/api/payments/config', {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),

  createPixPayment: (credits: number, accessToken: string) =>
    fetchJSON<{ payment: PixPayment }>('/api/payments/pix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ credits }),
    }),

  pixPayment: (id: string, accessToken: string) =>
    fetchJSON<{ payment: PixPayment }>(`/api/payments/pix/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),

  pixPayments: (accessToken: string) =>
    fetchJSON<{ payments: PixPayment[] }>('/api/payments/pix', {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),

  updateProfile: (data: { email?: string | null }, accessToken: string) =>
    fetchJSON<{ user: UserPublic }>(`${BASE}/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(data),
    }),
};
