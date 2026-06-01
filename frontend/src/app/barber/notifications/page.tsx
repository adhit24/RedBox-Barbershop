'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useUser } from '@/hooks/useUser';

interface Notif {
  id: string;
  title: string;
  body: string;
  created_at: string;
  read: boolean;
}

export default function NotificationsPage() {
  const { user } = useUser();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) { setLoading(false); return; }
        setNotifs((data ?? []) as Notif[]);
        setLoading(false);

        // Mark all as read
        const unreadIds = (data ?? [])
          .filter((n: Notif) => !n.read)
          .map((n: Notif) => n.id);
        if (unreadIds.length > 0) {
          supabase.from('notifications').update({ read: true }).in('id', unreadIds);
        }
      });
  }, [user?.id]);

  if (loading) {
    return <div className="p-4 text-center py-10 text-gray-400">Memuat...</div>;
  }

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-lg font-bold text-gray-900">Notifikasi</h2>

      {notifs.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">🔔</p>
          <p className="text-gray-500">Belum ada notifikasi</p>
        </div>
      ) : (
        notifs.map((n) => (
          <div
            key={n.id}
            className={`rounded-xl p-4 border ${
              n.read ? 'bg-white border-gray-100' : 'bg-blue-50 border-blue-100'
            }`}
          >
            <div className="flex justify-between items-start">
              <p
                className={`text-sm font-semibold ${
                  n.read ? 'text-gray-900' : 'text-blue-900'
                }`}
              >
                {n.title}
              </p>
              {!n.read && (
                <span className="w-2 h-2 bg-blue-500 rounded-full mt-1 flex-shrink-0" />
              )}
            </div>
            <p className="text-sm text-gray-600 mt-1">{n.body}</p>
            <p className="text-xs text-gray-400 mt-2">
              {new Date(n.created_at).toLocaleString('id-ID', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </p>
          </div>
        ))
      )}
    </div>
  );
}
