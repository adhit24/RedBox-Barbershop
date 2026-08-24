'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type StockistTheme = 'light' | 'dark';

const STORAGE_KEY = 'redbox-stockist-theme';

let currentTheme: StockistTheme = 'light';
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function hydrateFromStorage() {
  if (hydrated) return;
  hydrated = true;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      currentTheme = stored;
      emit();
    }
  } catch {
    // localStorage unavailable (e.g. private browsing) — stay on the light default.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  hydrateFromStorage();
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentTheme;
}

function getServerSnapshot(): StockistTheme {
  return 'light';
}

function setTheme(next: StockistTheme) {
  currentTheme = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore — theme still switches for this session even if it can't persist
  }
  emit();
}

export function useStockistTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleTheme = useCallback(() => {
    setTheme(currentTheme === 'light' ? 'dark' : 'light');
  }, []);

  return { theme, toggleTheme };
}
