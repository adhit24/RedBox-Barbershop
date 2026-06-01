'use client';
import { useEffect } from 'react';
import { useUser } from './useUser';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output.buffer as ArrayBuffer;
}

export function usePush() {
  const { user } = useUser();

  useEffect(() => {
    if (!user || user.role !== 'barber') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!VAPID_PUBLIC_KEY) return;

    async function subscribe() {
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();

        if (existing) {
          await saveSubscription(user!.id, existing);
          return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });

        await saveSubscription(user!.id, subscription);
      } catch (e) {
        console.error('Push subscribe error:', e);
      }
    }

    subscribe();
  }, [user]);
}

async function saveSubscription(userId: string, subscription: PushSubscription) {
  const json = subscription.toJSON() as {
    endpoint: string;
    keys?: { p256dh: string; auth: string };
  };

  if (!json.keys?.p256dh || !json.keys?.auth) return;

  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    }),
  });
}
