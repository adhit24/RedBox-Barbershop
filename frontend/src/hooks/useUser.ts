'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

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

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) { setUser(null); setLoading(false); return; }

        const { data } = await supabase
          .from('users')
          .select('name, role, branch, barber_id')
          .eq('id', authUser.id)
          .single();

        if (data) {
          setUser({
            id: authUser.id,
            email: authUser.email ?? '',
            name: data.name,
            role: data.role,
            branch: data.branch,
            barber_id: data.barber_id,
          });
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    load();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => load());
    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    await createClient().auth.signOut();
    window.location.href = '/login';
  }

  return { user, loading, signOut };
}
