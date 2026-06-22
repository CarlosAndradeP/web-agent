import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { authApi, type UserPublic } from '../lib/auth-api';

interface AuthState {
  user: UserPublic | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, email?: string) => Promise<void>;
  logout: () => void;
  updateCredits: (credits: number) => void;
}

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = 'webagent_access_token';
const REFRESH_KEY = 'webagent_refresh_token';
const USER_KEY = 'webagent_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(() => {
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  const [accessToken, setAccessToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [refreshToken, setRefreshToken] = useState<string | null>(() => localStorage.getItem(REFRESH_KEY));
  const [isLoading, setIsLoading] = useState(false);

  const storeAuth = (access: string, refresh: string, userData: UserPublic) => {
    localStorage.setItem(TOKEN_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
    setAccessToken(access);
    setRefreshToken(refresh);
    setUser(userData);
  };

  const clearAuth = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
  };

  const login = useCallback(async (username: string, password: string) => {
    setIsLoading(true);
    try {
      const data = await authApi.login(username, password);
      storeAuth(data.accessToken, data.refreshToken, data.user);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (username: string, password: string, email?: string) => {
    setIsLoading(true);
    try {
      const data = await authApi.register(username, password, email);
      storeAuth(data.accessToken, data.refreshToken, data.user);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    const token = accessToken;
    clearAuth();
    authApi.logout(token ?? undefined).catch(() => {});
  }, [accessToken]);

  const updateCredits = useCallback((credits: number) => {
    setUser(prev => prev ? { ...prev, credits } : null);
  }, []);

  useEffect(() => {
    if (!accessToken || !refreshToken) return;

    const interval = setInterval(async () => {
      try {
        const data = await authApi.refresh(refreshToken);
        storeAuth(data.accessToken, data.refreshToken, data.user);
      } catch {
        clearAuth();
      }
    }, 14 * 60 * 1000);

    return () => clearInterval(interval);
  }, [accessToken, refreshToken]);

  useEffect(() => {
    if (!accessToken) return;

    let refreshing = false;
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.status === 401 && !refreshing && refreshToken) {
        refreshing = true;
        try {
          const data = await authApi.refresh(refreshToken);
          storeAuth(data.accessToken, data.refreshToken, data.user);
          const newReq = new Request(args[0] instanceof Request ? args[0].url : String(args[0]), {
            ...args[1],
            headers: {
              ...(args[0] instanceof Request ? Object.fromEntries(args[0].headers.entries()) : {}),
              ...(args[1]?.headers as Record<string, string> || {}),
              Authorization: `Bearer ${data.accessToken}`,
            },
          });
          refreshing = false;
          return originalFetch(newReq);
        } catch {
          refreshing = false;
          clearAuth();
        }
      }
      return response;
    };

    return () => { window.fetch = originalFetch; };
  }, [accessToken, refreshToken]);

  return (
    <AuthContext.Provider value={{
      user,
      accessToken,
      refreshToken,
      isAuthenticated: !!user,
      isLoading,
      login,
      register,
      logout,
      updateCredits,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
