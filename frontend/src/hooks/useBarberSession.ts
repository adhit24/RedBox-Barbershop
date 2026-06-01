'use client';
import { useEffect, useState } from 'react';
import { fetchBarberMe, logoutBarber } from '@/lib/barberApi';
import type { BarberMeResponse } from '@/lib/barberTypes';

export function useBarberSession() {
  const [data, setData] = useState<BarberMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetchBarberMe();
      setData(res);
      setError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'failed';
      setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function signOut() {
    await logoutBarber().catch(() => {});
    window.location.href = '/barber/login';
  }

  return { data, loading, error, refresh, signOut };
}
