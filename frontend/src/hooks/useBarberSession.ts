'use client';
import { useCallback, useEffect, useState } from 'react';
import { fetchBarberMe, logoutBarber } from '@/lib/barberApi';
import type { BarberMeResponse } from '@/lib/barberTypes';

export function useBarberSession() {
  const [data, setData] = useState<BarberMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);

    // Cookie session can land a moment after the OTP response resolves.
    // A short retry prevents a transient 401 from sending the user back to OTP.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetchBarberMe();
        setData(res);
        setError(null);
        setLoading(false);
        return res;
      } catch (e: unknown) {
        if (attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 250));
          continue;
        }
        const msg = e instanceof Error ? e.message : 'failed';
        setError(msg);
        setData(null);
      }
    }

    setLoading(false);
    return null;
  }, []);

  useEffect(() => {
    // Initial session hydration is intentionally performed from the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function signOut() {
    await logoutBarber().catch(() => {});
    window.location.href = '/barber/login';
  }

  return { data, loading, error, refresh, signOut };
}
