'use client';

import { useSyncExternalStore } from 'react';

interface ToastState {
  id: number;
  message: string;
}

let toast: ToastState | null = null;
let nextId = 0;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return toast;
}

function getServerSnapshot(): ToastState | null {
  return null;
}

export function showToast(message: string) {
  if (dismissTimer) clearTimeout(dismissTimer);
  nextId += 1;
  toast = { id: nextId, message };
  emit();
  dismissTimer = setTimeout(() => {
    toast = null;
    emit();
  }, 2200);
}

export function useToast() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
