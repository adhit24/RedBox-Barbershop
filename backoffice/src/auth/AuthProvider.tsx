import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type BackofficeRole = 'owner' | 'manager' | null;

const OWNER_EMAILS = new Set([
  'adhit24@gmail.com',
  'suwandi_gunawan@yahoo.com',
]);

interface BackofficeProfile {
  name: string | null;
  role: string | null;
  branch: string | null;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  currentUser: { label: string; email: string } | null;
  role: BackofficeRole;
  branchScope: string | null;
  permissions: string[];
  loginError: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function resolveRole(user: User, profile: BackofficeProfile | null): BackofficeRole {
  const email = String(user.email || '').trim().toLowerCase();
  if (OWNER_EMAILS.has(email)) return 'owner';
  const role = String(profile?.role || '').trim().toLowerCase();
  return role === 'owner' || role === 'manager' ? role : null;
}

async function getProfile(userId: string): Promise<BackofficeProfile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('name,role,branch')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as BackofficeProfile | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ label: string; email: string } | null>(null);
  const [role, setRole] = useState<BackofficeRole>(null);
  const [branchScope, setBranchScope] = useState<string | null>(null);

  const clearLocalAuth = useCallback(() => {
    setCurrentUser(null);
    setRole(null);
    setBranchScope(null);
  }, []);

  const hydrateAuthorizedUser = useCallback(async (user: User): Promise<boolean> => {
    const profile = await getProfile(user.id);
    const resolvedRole = resolveRole(user, profile);
    if (!resolvedRole) {
      clearLocalAuth();
      return false;
    }

    const email = String(user.email || '').trim().toLowerCase();
    setCurrentUser({
      label: profile?.name?.trim() || user.user_metadata?.name || email.split('@')[0] || 'Backoffice User',
      email,
    });
    setRole(resolvedRole);
    setBranchScope(resolvedRole === 'manager' ? (profile?.branch || null) : null);
    return true;
  }, [clearLocalAuth]);

  const login = useCallback(async (username: string, password: string) => {
    setLoginError(null);
    const email = username.trim().toLowerCase();

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) {
        setLoginError('Username atau password salah.');
        return false;
      }

      const allowed = await hydrateAuthorizedUser(data.user);
      if (!allowed) {
        await supabase.auth.signOut();
        setLoginError('Akun ini tidak memiliki akses ke Backoffice.');
        return false;
      }
      return true;
    } catch {
      clearLocalAuth();
      setLoginError('Server tidak merespons, coba lagi.');
      return false;
    }
  }, [clearLocalAuth, hydrateAuthorizedUser]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut().catch(() => undefined);
    clearLocalAuth();
  }, [clearLocalAuth]);

  useEffect(() => {
    let active = true;

    const applySession = async (user: User | null) => {
      if (!active) return;
      if (!user) {
        clearLocalAuth();
        setIsLoading(false);
        return;
      }
      try {
        const allowed = await hydrateAuthorizedUser(user);
        if (!allowed) await supabase.auth.signOut();
      } catch {
        clearLocalAuth();
      } finally {
        if (active) setIsLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data }) => applySession(data.session?.user ?? null));

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session?.user ?? null);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [clearLocalAuth, hydrateAuthorizedUser]);

  const value = useMemo<AuthState>(
    () => ({
      isAuthenticated: Boolean(currentUser && role),
      isLoading,
      currentUser,
      role,
      branchScope,
      permissions: [],
      loginError,
      login,
      logout,
    }),
    [branchScope, currentUser, isLoading, login, loginError, logout, role]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
