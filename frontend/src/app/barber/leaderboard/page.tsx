'use client';
import { useEffect, useState } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { fetchBarberLeaderboard } from '@/lib/barberApi';
import { TierIndicator } from '@/components/barber/TierIndicator';
import { TIER_CONFIG } from '@/lib/achievementDefs';
import type { LeaderboardData } from '@/lib/barberTypes';

const MEDAL = ['🥇', '🥈', '🥉'];

function getTier(positionPct: number): 'LEGEND' | 'ELITE' | 'ADVANCED' | 'RISING' {
  if (positionPct <= 10) return 'LEGEND';
  if (positionPct <= 30) return 'ELITE';
  if (positionPct <= 70) return 'ADVANCED';
  return 'RISING';
}

export default function LeaderboardPage() {
  const { data: session } = useBarberSession();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    fetchBarberLeaderboard()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session]);

  if (loading || !data) {
    return <div className="p-4 text-center text-gray-400">Memuat...</div>;
  }

  const total = data.barber_count;

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">🏆 Ranking Semua Cabang</h2>
      <p className="text-sm text-gray-500">Bulan ini — semua kapster</p>

      <TierIndicator data={data} />

      {data.next_tier_needed > 0 && (
        <p className="text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
          +{data.next_tier_needed} customer lagi untuk naik tier
        </p>
      )}

      {/* Ranking list */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Peringkat Bulan Ini</p>
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
    </div>
  );
}
