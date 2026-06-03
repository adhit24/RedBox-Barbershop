'use client';
import { useEffect, useState, useCallback } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { fetchBarberFeed } from '@/lib/barberApi';
import type { SocialFeedItem } from '@/lib/barberTypes';

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return 'baru saja';
  if (diff < 3600)  return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return `${Math.floor(diff / 86400)} hari lalu`;
}

export default function FeedPage() {
  const { data: session } = useBarberSession();
  const [items, setItems] = useState<SocialFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (off: number) => {
    if (!session) return;
    const res = await fetchBarberFeed(off);
    if (off === 0) {
      setItems(res.items);
    } else {
      setItems(prev => [...prev, ...res.items]);
    }
    setHasMore(res.items.length === 20);
  }, [session]);

  useEffect(() => {
    load(0).catch(console.error).finally(() => setLoading(false));
  }, [load]);

  const loadMore = async () => {
    const next = offset + 20;
    setLoadingMore(true);
    await load(next).catch(console.error);
    setOffset(next);
    setLoadingMore(false);
  };

  if (loading) return <div className="p-4 text-center text-gray-400">Memuat...</div>;

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-lg font-bold text-gray-900">📣 Feed Aktivitas</h2>

      {items.length === 0 && (
        <p className="text-center text-gray-400 py-10">Belum ada aktivitas</p>
      )}

      {items.map(item => (
        <div key={item.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex gap-3 items-start">
          <span className="text-2xl flex-shrink-0">{item.emoji || '📌'}</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-800 text-sm">{item.title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{item.body}</p>
            <p className="text-[11px] text-gray-300 mt-1">{timeAgo(item.created_at)} · {item.branch}</p>
          </div>
        </div>
      ))}

      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full py-2 text-sm text-gray-500 border border-gray-200 rounded-xl"
        >
          {loadingMore ? 'Memuat...' : 'Lihat lebih banyak'}
        </button>
      )}
    </div>
  );
}
