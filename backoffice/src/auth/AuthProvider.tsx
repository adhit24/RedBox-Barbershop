// TEMPORARY COMPATIBILITY AUTH.
// Backed by the single shared ADMIN_PASSWORD token today — role/branchScope/
// permissions are placeholders, not real server-enforced RBAC. See spec §3/§4.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  clearToken,
  getStoredToken,
  onUnauthorized,
  storeToken,
  validateAdminToken,
} from '../lib/apiClient';

export type BackofficeRole = 'owner' | 'manager' | 'admin' | null;

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  currentUser: { label: string } | null;
  role: BackofficeRole;
  branchScope: string | null;
  permissions: string[];
  loginError: string | null;
  login: (password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  const logout = useCallback(() => {
    clearToken();
    setIsAuthenticated(false);
  }, []);

  const login = useCallback(async (password: string) => {
    setLoginError(null);
    try {
      const valid = await validateAdminToken(password);
      if (!valid) {
        setLoginError('Password salah.');
        return false;
      }
      storeToken(password);
      setIsAuthenticated(true);
      return true;
    } catch {
      setLoginError('Server tidak merespons, coba lagi.');
      return false;
    }
  }, []);

  // Boot: if a token is already in sessionStorage, revalidate it in the background.
  useEffect(() => {
    const existing = getStoredToken();
    if (!existing) {
      setIsLoading(false);
      return;
    }
    validateAdminToken(existing)
      .then((valid) => {
        if (valid) {
          setIsAuthenticated(true);
        } else {
          clearToken();
        }
      })
      .catch(() => {
        // Network error on boot: keep the stored token optimistically rather
        // than forcing a logout on a transient failure.
        setIsAuthenticated(true);
      })
      .finally(() => setIsLoading(false));
  }, []);

  // Any 401 from apiClient anywhere in the app forces a clean logout.
  useEffect(() => onUnauthorized(logout), [logout]);

  const value = useMemo<AuthState>(
    () => ({
      isAuthenticated,
      isLoading,
      currentUser: isAuthenticated ? { label: 'Backoffice Admin' } : null,
      // Placeholders — no per-user identity exists server-side yet (spec §4).
      role: isAuthenticated ? 'owner' : null,
      branchScope: null,
      permissions: [],
      loginError,
      login,
      logout,
    }),
    [isAuthenticated, isLoading, loginError, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
