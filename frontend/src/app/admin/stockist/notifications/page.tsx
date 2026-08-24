'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listNotifications, markNotificationRead, markAllNotificationsRead, type StockistNotification } from '@/lib/stockistApi';
import { EmptyState } from '@/components/stockist/EmptyState';
import { SkeletonCard } from '@/components/stockist/SkeletonCard';
import { refreshUnreadCount, useUnreadNotificationCount } from '@/lib/stockist/useUnreadNotifications';

const CATEGORIES = ['Semua', 'Stok', 'Transfer', 'Pengiriman', 'Sistem', 'Pengumuman'] as const;

const CATEGORY_ICON: Record<StockistNotification['category'], string> = {
  Stok: 'inventory_2',
  Transfer: 'local_shipping',
  Pengiriman: 'task_alt',
  Sistem: 'sync_problem',
  Pengumuman: 'campaign',
};

const CATEGORY_TINT: Record<StockistNotification['category'], { bg: string; text: string }> = {
  Stok: { bg: 'bg-tint-warning', text: 'text-warning' },
  Transfer: { bg: 'bg-tint-danger', text: 'text-danger' },
  Pengiriman: { bg: 'bg-tint-success', text: 'text-success' },
  Sistem: { bg: 'bg-tint-info', text: 'text-info' },
  Pengumuman: { bg: 'bg-tint-info', text: 'text-info' },
};

export default function NotificationsPage() {
  const router = useRouter();
  const [chip, setChip] = useState<(typeof CATEGORIES)[number]>('Semua');
  const [items, setItems] = useState<StockistNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(null);
    setError(null);
    listNotifications(chip === 'Semua' ? undefined : chip)
      .then(({ notifications }) => setItems(notifications))
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat notifikasi'));
  }, [chip]);

  const globalUnreadCount = useUnreadNotificationCount();

  async function openNotification(n: StockistNotification) {
    if (!n.is_read) {
      try {
        await markNotificationRead(n.id);
        setItems((prev) => prev?.map((row) => (row.id === n.id ? { ...row, is_read: true } : row)) ?? prev);
        refreshUnreadCount();
      } catch {
        // non-fatal — still navigate even if marking read failed
      }
    }
    if (n.url) router.push(n.url);
  }

  async function markAllRead() {
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev?.map((row) => ({ ...row, is_read: true })) ?? prev);
      refreshUnreadCount();
    } catch {
      // non-fatal
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between px-1">
        <span className="text-[12px] font-semibold text-text-muted">{globalUnreadCount > 0 ? `${globalUnreadCount} belum dibaca` : 'Semua sudah dibaca'}</span>
        {globalUnreadCount > 0 && chip === 'Semua' && (
          <button onClick={markAllRead} className="text-[11px] font-semibold text-primary-container">
            Tandai semua dibaca
          </button>
        )}
      </div>

      <div className="sc flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setChip(c)}
            className={`flex-none h-[34px] px-3.5 rounded-full text-[12px] font-bold border transition-colors ${
              chip === c ? 'bg-primary-container border-primary-container text-white' : 'bg-surface-elevated border-border-base text-text-secondary'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-danger bg-danger/10 p-3 text-[12px] text-danger">{error}</div>
      )}

      {items === null && !error && (
        <div className="flex flex-col gap-2.5">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {items && items.length === 0 && (
        <EmptyState icon="notifications_off" title="Belum ada notifikasi" subtitle="Notifikasi baru akan muncul di sini." />
      )}

      {items && items.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => openNotification(n)}
              className={`flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors ${
                n.is_read ? 'bg-surface-container border-surface-container' : 'bg-surface-elevated border-border-base'
              }`}
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${CATEGORY_TINT[n.category].bg}`}>
                <span className={`material-symbols-outlined text-[19px] ${CATEGORY_TINT[n.category].text}`}>{CATEGORY_ICON[n.category]}</span>
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-text-primary">{n.title}</span>
                  {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary-container" />}
                </div>
                <span className="text-[11px] text-text-secondary">{n.body}</span>
                <span className="text-[10px] text-text-muted">
                  {new Date(n.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} WIB
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
