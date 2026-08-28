import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from '../../foundation/api-client';
import { mapSessionUser, tokensFromLogin, type AuthUser } from '../../foundation/auth';
import { WebTokenStore } from '../../foundation/token-store';
import { browserFetch } from '../browser-fetch';
import { runtimeEnv, runtimeIsDev } from '../runtime';
import { frontendLog } from '../../foundation/log';
import { useI18n } from './I18nProvider';

type AuthValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  api: ApiClient;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  restoreSession: () => Promise<void>;
  setTenantId: (tenantId: string) => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { language, setLanguage } = useI18n();
  const tokens = useRef(new WebTokenStore());
  const langRef = useRef(language);
  langRef.current = language;
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const api = useMemo(
    () =>
      new ApiClient({
        getEnv: runtimeEnv,
        tokens: tokens.current,
        getLanguage: () => langRef.current,
        fetchFn: browserFetch,
        onSessionCleared: () => setUser(null),
      }),
    []
  );

  const restoreSession = useCallback(async () => {
    const stored = tokens.current.load();
    if (!stored.accessToken) {
      setUser(null);
      return;
    }
    try {
      const res = await api.get('/auth/session');
      const next = mapSessionUser(res.data);
      setUser(next);
      if (next?.preferredLanguage || next?.lang) setLanguage(next.preferredLanguage || next.lang || language);
    } catch {
      tokens.current.clear();
      setUser(null);
    }
  }, [api, language, setLanguage]);

  const refreshSession = restoreSession;

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post('/auth/login', { email, password });
      const parsed = tokensFromLogin(res.data);
      if (!parsed.accessToken || !parsed.user?.roleId) {
        throw new Error('LOGIN_FAILED');
      }
      tokens.current.save({
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        tenantId: parsed.tenantId,
      });
      setUser(parsed.user);
      if (parsed.user?.preferredLanguage || parsed.user?.lang) {
        setLanguage(parsed.user.preferredLanguage || parsed.user.lang || language);
      }
      frontendLog(runtimeIsDev(), 'login', parsed.user?.roleId);
    },
    [api, language, setLanguage]
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      /* session already invalid */
    }
    tokens.current.clear();
    setUser(null);
  }, [api]);

  const setTenantId = useCallback((tenantId: string) => {
    const cur = tokens.current.load();
    tokens.current.save({ ...cur, tenantId });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = tokens.current.load();
      if (!stored.accessToken) {
        if (!cancelled) setUser(null);
        return;
      }
      try {
        const res = await api.get('/auth/session');
        const next = mapSessionUser(res.data);
        if (!cancelled) setUser(next);
        if (next?.preferredLanguage || next?.lang) setLanguage(next.preferredLanguage || next.lang || langRef.current);
      } catch {
        tokens.current.clear();
        if (!cancelled) setUser(null);
      }
    })().finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [api, setLanguage]);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      api,
      login,
      logout,
      refreshSession,
      restoreSession,
      setTenantId,
    }),
    [user, isLoading, api, login, logout, refreshSession, restoreSession, setTenantId]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider required');
  return ctx;
}
