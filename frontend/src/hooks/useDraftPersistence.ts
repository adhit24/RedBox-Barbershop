'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

export function useDraftPersistence<T>(key: string, initialValue: T): [T, (next: T) => void, () => void] {
  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }, [key]);

  const getServerSnapshot = useCallback(() => null, []);

  const storedRaw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [draft, setDraft] = useState<T | null>(null);

  let value: T = initialValue;
  if (draft !== null) {
    value = draft;
  } else if (storedRaw !== null) {
    try {
      value = JSON.parse(storedRaw) as T;
    } catch {
      value = initialValue;
    }
  }

  const persist = useCallback(
    (next: T) => {
      setDraft(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore — draft still works for this session even if it can't persist
      }
    },
    [key]
  );

  const clear = useCallback(() => {
    setDraft(initialValue);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }, [initialValue, key]);

  return [value, persist, clear];
}
