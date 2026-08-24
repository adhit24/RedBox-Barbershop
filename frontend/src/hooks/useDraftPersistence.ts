'use client';

import { useCallback, useEffect, useState } from 'react';

export function useDraftPersistence<T>(key: string, initialValue: T): [T, (next: T) => void, () => void] {
  const [value, setValue] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) {
        setValue(JSON.parse(stored) as T);
      }
    } catch {
      // localStorage unavailable or the stored value isn't valid JSON — start fresh.
    } finally {
      setHydrated(true);
    }
    // Only run once per mount for this key — re-running on `initialValue` identity
    // changes would clobber a just-hydrated draft with the caller's default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const persist = useCallback((next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore — draft still works for this session even if it can't persist
    }
  }, [key]);

  const clear = useCallback(() => {
    setValue(initialValue);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [hydrated ? value : initialValue, persist, clear];
}
