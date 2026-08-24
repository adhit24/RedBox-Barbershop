'use client';

import { useSyncExternalStore } from 'react';
import { listNotifications } from '@/lib/stockistApi';

let unreadCount = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return unreadCount;
}

function getServerSnapshot() {
  return 0;
}

export async function refreshUnreadCount() {
  try {
    const { notifications } = await listNotifications();
    unreadCount = notifications.filter((n) => !n.is_read).length;
  } catch {
    // non-fatal — leave the count as it was
  }
  emit();
}

export function useUnreadNotificationCount() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
