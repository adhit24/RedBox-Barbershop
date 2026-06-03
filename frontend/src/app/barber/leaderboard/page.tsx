'use client';
import { useEffect, useState } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { fetchBarberLeaderboard, fetchLeaderboardCategory } from '@/lib/barberApi';
import { TierIndicator } from '@/components/barber/TierIndicator';
import { TIER_CONFIG } from '@/lib/achievementDefs';
import type { LeaderboardData, LeaderboardCategoryItem } from '@/lib/barberTypes';

const MEDAL = ['🥇', '🥈', '🥉'];

type Category = 'live' | 'customer_champion' | 'streak_champion';

const CATEGORIES: { key: Category; label: string; icon: string }[] = [
  { key: 'live',              label: 'Live',    icon: '⚡' },
  { key: 'customer_champion', label: 'Customer', icon: '👥' },
  { key: 'streak_champion',   label: 'Streak',   icon: '🔥' },
];

function getTier(positionPct: number): 'LEGEND' | 'ELITE' | 'ADVANCED' | 'RISING' {
  if (positionPct <= 10) return 'LEGEND';
  if (positionPct <= 30) return 'ELITE';
  if (positionPct <= 70) return 'ADVANCED';
  return 'RISING';
}

export default function LeaderboardPage() {
  const { data: session } = useBarberSession();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [category, setCategory] = useState<Category>('live');
  const [categoryItems, setCategoryItems] = useState<LeaderboardCategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [catLoading, setCatLoading] = useState(false);

  useEffect(() => {
    if (!session) return;
    fetchBarberLeaderboard()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session]);

  useEffect(() => {
    if (!session || category === 'live') return;
    setCatLoading(true);
    fetchLeaderboardCategory(category as 'customer_champion' | 'streak_champion')
      .then(res => setCategoryItems(res.items))
      .catch(console.error)
      .finally(() => setCatLoading(false));
  }, [category, session]);

  if (loading || !data) {
    return <div className="p-4 text-center text-gray-400">Memuat...</div>;
  }

  const total = data.barber_count;

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">🏆 Ranking</h2>

      <TierIndicator data={data} />

      {data.next_tier_needed > 0 && (
        <p className="text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
          +{data.next_tier_needed} customer lagi untuk naik tier
        </p>
      )}

      {/* Category Tabs */}
      <div className="flex gap-2">
        {CATEGORIES.map(c => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${
              category === c.key
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-500 border-gray-200'
            }`}
          >
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      {/* Live Rankings */}
      {category === 'live' && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Bulan Ini — Semua Cabang</p>
          {(data.rankings || []).map((entry) => {
            const entryPct = total > 0 ? Math.round((entry.rank / total) * 100) : 100;
            const entryTier = getTier(entryPct);
            const tierConf = TIER_CONFIG[entryTier];
            const medal = MEDAL[entry.rank - 1] ?? null;

            return (
              <div
                key={entry.barber_id}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                  entry.is_me
                    ? `${tierConf.bg} border-2 border-current ${tierConf.color} shadow-sm`
                    : 'bg-white border-gray-100'
                }`}
              >
                <span className="w-7 text-center text-base font-bold">
                  {medal ?? <span className="text-gray-400 text-sm">#{entry.rank}</span>}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`font-medium truncate ${entry.is_me ? tierConf.color : 'text-gray-700'}`}>
                    {entry.name}
                    {entry.is_me && <span className="ml-2 text-xs opacity-70">(Kamu)</span>}
                  </p>
                  <p className="text-xs text-gray-400 capitalize">{entry.branch}</p>
                </div>
                <span className={`text-sm font-bold ${entry.is_me ? tierConf.color : 'text-gray-500'}`}>
                  {entry.total_count} cust
                </span>
                <span className="text-base">{tierConf.icon}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Category Rankings (from cache) */}
      {category !== 'live' && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            {category === 'streak_champion' ? 'Streak Terpanjang' : 'Total Customer'} — Bulan Ini
          </p>
          {catLoading ? (
            <p className="text-center text-gray-400 py-4">Memuat...</p>
          ) : categoryItems.length === 0 ? (
            <p className="text-center text-gray-400 py-4">Data belum tersedia (cron berjalan tengah malam)</p>
          ) : (
            categoryItems.map(item => {
              const medal = MEDAL[item.rank - 1] ?? null;
              const isMe = item.barber_id === session?.barber?.id;
              return (
                <div
                  key={item.barber_id}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                    isMe ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-100'
                  }`}
                >
                  <span className="w-7 text-center text-base font-bold">
                    {medal ?? <span className={`text-sm ${isMe ? 'text-gray-300' : 'text-gray-400'}`}>#{item.rank}</span>}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium truncate ${isMe ? 'text-white' : 'text-gray-700'}`}>
                      {item.barber_name}
                      {isMe && <span className="ml-2 text-xs opacity-70">(Kamu)</span>}
                    </p>
                    <p className={`text-xs capitalize ${isMe ? 'text-gray-300' : 'text-gray-400'}`}>{item.branch}</p>
                  </div>
                  <span className={`text-sm font-bold ${isMe ? 'text-white' : 'text-gray-600'}`}>
                    {item.display_value}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
