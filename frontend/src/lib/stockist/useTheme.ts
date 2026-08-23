'use client';

import { useCallback, useEffect, useState } from 'react';

export type StockistTheme = 'light' | 'dark';

const STORAGE_KEY = 'redbox-stockist-theme';

export function useStockistTheme() {
  const [theme, setTheme] = useState<StockistTheme>('light');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') setTheme(stored);
    } catch {
      // localStorage unavailable (e.g. private browsing) — stay on the light default.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: StockistTheme = prev === 'light' ? 'dark' : 'light';
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore — theme still switches for this session even if it can't persist
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
