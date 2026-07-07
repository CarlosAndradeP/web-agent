import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { authApi, type UserPublic } from '../lib/auth-api';
import { setAuthFetch } from '../lib/api';
import { connectWithAuth, disconnectSocket } from '../lib/socket';
import type { Socket } from 'socket.io-client';

interface AuthState {
  user: UserPublic | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, email: string) => Promise<void>;
  logout: () => void;
  updateCredits: (credits: number) => void;
  updateUser: (updates: Partial<UserPublic>) => void;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
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

  // Use refs for tokens so fetch interceptors always read the latest value
  const accessTokenRef = useRef(accessToken);
  const refreshTokenRef = useRef(refreshToken);

  useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);
  useEffect(() => { refreshTokenRef.current = refreshToken; }, [refreshToken]);

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

  const register = useCallback(async (username: string, password: string, email: string) => {
    setIsLoading(true);
    try {
      const data = await authApi.register(username, password, email);
      storeAuth(data.accessToken, data.refreshToken, data.user);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    const token = accessTokenRef.current;
    clearAuth();
    authApi.logout(token ?? undefined).catch(() => {});
  }, []);

  const updateCredits = useCallback((credits: number) => {
    setUser(prev => {
      if (!prev) return null;
      const updated = { ...prev, credits };
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateUser = useCallback((updates: Partial<UserPublic>) => {
    setUser(prev => {
      if (!prev) return null;
      const updated = { ...prev, ...updates };
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Auth-aware fetch: adds Authorization header, handles 401 with transparent refresh
  const refreshingRef = useRef(false);
  const authFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = accessTokenRef.current;
    const headers = new Headers(init?.headers);
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(input, { ...init, headers });

    if (response.status === 401 && !refreshingRef.current) {
      const currentRefreshToken = refreshTokenRef.current;
      if (!currentRefreshToken) {
        clearAuth();
        return response;
      }

      refreshingRef.current = true;
      try {
        const data = await authApi.refresh(currentRefreshToken);
        storeAuth(data.accessToken, data.refreshToken, data.user);

        // Retry the original request with new token
        const retryHeaders = new Headers(init?.headers);
        retryHeaders.set('Authorization', `Bearer ${data.accessToken}`);
        return fetch(input, { ...init, headers: retryHeaders });
      } catch {
        clearAuth();
      } finally {
        refreshingRef.current = false;
      }
    }

    return response;
  }, []);

  // Register authFetch with the API module on mount
  useEffect(() => {
    setAuthFetch(authFetch);
  }, [authFetch]);

  // Auto-refresh token before expiry (every 14 minutes)
  useEffect(() => {
    if (!accessToken || !refreshToken) return;

    const interval = setInterval(async () => {
      const currentRefreshToken = refreshTokenRef.current;
      if (!currentRefreshToken) return;
      try {
        const data = await authApi.refresh(currentRefreshToken);
        storeAuth(data.accessToken, data.refreshToken, data.user);
      } catch {
        clearAuth();
      }
    }, 14 * 60 * 1000);

    return () => clearInterval(interval);
  }, [accessToken, refreshToken]);

  // Socket.IO connection using singleton — managed by AuthContext lifecycle.
  // Re-connect whenever the access token changes so the socket handshake uses
  // a fresh token (the previous one may have expired after a refresh).
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!user || !accessToken) {
      disconnectSocket();
      socketRef.current = null;
      return;
    }

    const socket = connectWithAuth(accessToken);
    socketRef.current = socket;

    const joinRoom = () => {
      socket.emit('user:join', { userId: user.id });
    };

    socket.on('connect', joinRoom);
    if (socket.connected) joinRoom();

    socket.on('credits:deducted', (data: { userId: string; newBalance: number }) => {
      if (data.userId === user.id) {
        updateCredits(data.newBalance);
      }
    });

    socket.on('credits:added', (data: { userId: string; newBalance: number }) => {
      if (data.userId === user.id) {
        updateCredits(data.newBalance);
      }
    });

    socket.on('credits:exhausted', (data: { userId: string }) => {
      if (data.userId === user.id) {
        updateCredits(0);
      }
    });

    return () => {
      socket.off('connect', joinRoom);
      socket.off('credits:deducted');
      socket.off('credits:added');
      socket.off('credits:exhausted');
      disconnectSocket();
      socketRef.current = null;
    };
  }, [user?.id, accessToken, updateCredits]);

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
      updateUser,
      authFetch,
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
