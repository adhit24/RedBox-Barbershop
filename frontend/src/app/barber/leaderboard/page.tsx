'use client';
import { useEffect, useState } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { fetchBarberLeaderboard } from '@/lib/barberApi';
import { TierIndicator } from '@/components/barber/TierIndicator';
import { TIER_CONFIG } from '@/lib/achievementDefs';
import type { LeaderboardData } from '@/lib/barberTypes';

const TIERS = ['LEGEND', 'ELITE', 'ADVANCED', 'RISING'] as const;

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

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">🏆 Leaderboard</h2>
      <p className="text-sm text-gray-500 capitalize">Cabang {session?.barber.branch} — Bulan ini</p>

      <TierIndicator data={data} />

      {/* Tier ladder visualization */}
      <div className="space-y-2 pt-2">
        {TIERS.map(tier => {
          const config = TIER_CONFIG[tier];
          const isMyTier = data.tier === tier;
          return (
            <div
              key={tier}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                isMyTier ? `${config.bg} border-current ${config.color}` : 'bg-gray-50 border-gray-100'
              }`}
            >
              <span className="text-2xl">{config.icon}</span>
              <div className="flex-1">
                <p className={`font-semibold ${isMyTier ? config.color : 'text-gray-500'}`}>
                  {config.label}
                </p>
                <p className="text-xs text-gray-400">
                  {tier === 'LEGEND' && 'Top 10%'}
                  {tier === 'ELITE' && 'Top 11-30%'}
                  {tier === 'ADVANCED' && 'Middle 31-70%'}
                  {tier === 'RISING' && 'Bottom 70-100%'}
                </p>
              </div>
              {isMyTier && (
                <span className="text-sm font-bold">← Kamu</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-xl p-4 border border-gray-100">
        <p className="text-sm text-gray-600">
          Kamu saat ini: <span className="font-bold">{data.my_count} customer</span> bulan ini
        </p>
        {data.next_tier_needed > 0 && (
          <p className="text-sm text-gray-500 mt-1">
            Naik tier butuh: +{data.next_tier_needed} customer lagi
          </p>
        )}
      </div>
    </div>
  );
}
