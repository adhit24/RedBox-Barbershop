'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { resolveStockistRole } from '@/app/admin/stockist/stockistRole';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'branch_admin' | 'barber';
  branch: string | null;
  barber_id: string | null;
}

export function useUser() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    async function loadProfile(authUser: { id: string; email?: string }) {
      try {
        const { data } = await supabase
          .from('users')
          .select('name, role, branch, barber_id')
          .eq('id', authUser.id)
          .single();
        if (!mounted) return;
        if (data) {
          setUser({
            id: authUser.id,
            email: authUser.email ?? '',
            name: data.name,
            role: resolveStockistRole(authUser.email, data.role) as AppUser['role'],
            branch: data.branch,
            barber_id: data.barber_id,
          });
        } else {
          setUser(null);
        }
      } catch {
        if (mounted) setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    // onAuthStateChange fires INITIAL_SESSION immediately from cached cookies
    // without waiting for token refresh network calls — avoids the getSession() hang
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const authUser = session?.user ?? null;
      if (!authUser) {
        setUser(null);
        setLoading(false);
        return;
      }
      loadProfile(authUser);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      await Promise.race([
        createClient().auth.signOut(),
        new Promise(resolve => setTimeout(resolve, 3000)),
      ]);
    } catch {
      // proceed regardless
    }
    window.location.href = '/';
  }

  return { user, loading, signOut, signingOut };
}
