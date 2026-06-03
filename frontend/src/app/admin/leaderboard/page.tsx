'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchAdminLeaderboard } from '@/lib/adminCrmApi';
import type { LeaderboardItem } from '@/lib/adminCrmTypes';

type Category = 'customer' | 'streak' | 'home_service';

const CATS: { key: Category; label: string; icon: string }[] = [
  { key: 'customer',     label: 'Customer',    icon: '👥' },
  { key: 'streak',       label: 'Streak',      icon: '🔥' },
  { key: 'home_service', label: 'Home Service',icon: '🏠' },
];

const MEDAL = ['🥇','🥈','🥉'];

export default function AdminLeaderboardPage() {
  const { user } = useUser();
  const branch = user?.branch || '';
  const [category, setCategory] = useState<Category>('customer');
  const [items, setItems] = useState<LeaderboardItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!branch) return;
    setLoading(true);
    fetchAdminLeaderboard(branch, category)
      .then(r => setItems(r.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [branch, category]);

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">🏆 Leaderboard Cabang</h2>

      <div className="flex gap-2">
        {CATS.map(c => (
          <button key={c.key} onClick={() => setCategory(c.key)}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
              category === c.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200'
            }`}>
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-center text-gray-400 py-8">Memuat...</p>
      ) : items.length === 0 ? (
        <p className="text-center text-gray-400 py-8">Tidak ada data</p>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                item.rank <= 3 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'
              }`}>
              <span className="w-7 text-center font-bold">
                {MEDAL[item.rank - 1] ?? <span className="text-sm text-gray-400">#{item.rank}</span>}
              </span>
              <div className="flex-1">
                <p className="font-semibold text-gray-800 text-sm">{item.name}</p>
              </div>
              <span className="text-sm font-bold text-gray-600">{item.display}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
