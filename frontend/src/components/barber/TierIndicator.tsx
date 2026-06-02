import type { LeaderboardData } from '@/lib/barberTypes';
import { TIER_CONFIG } from '@/lib/achievementDefs';

export function TierIndicator({ data }: { data: LeaderboardData }) {
  const tier = TIER_CONFIG[data.tier];
  return (
    <div className={`${tier.bg} rounded-2xl p-4 border`}>
      <div className="flex justify-between items-center">
        <div>
          <p className="text-xs text-gray-500">🏆 Tier Kamu</p>
          <p className={`text-xl font-bold ${tier.color}`}>
            {tier.icon} {tier.label}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-600">{data.my_count} customer</p>
          <p className="text-xs text-gray-400">{data.barber_count} kapster di cabang</p>
        </div>
      </div>
      {data.next_tier_needed > 0 && (
        <p className="text-xs text-gray-500 mt-2">
          Butuh +{data.next_tier_needed} customer untuk naik tier
        </p>
      )}
    </div>
  );
}
