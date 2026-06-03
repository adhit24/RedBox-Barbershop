import type { AchievementsResponse } from '@/lib/barberTypes';
import { BADGE_DEFS, RARITY_CONFIG } from '@/lib/achievementDefs';

export function BadgeGrid({ data }: { data: AchievementsResponse }) {
  const earnedMap = new Map(data.earned.map(e => [e.badge_key, e]));

  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-3">🏅 Badges</p>
      <div className="grid grid-cols-3 gap-2">
        {BADGE_DEFS.map(def => {
          const earned = earnedMap.has(def.key);
          const prog = data.in_progress.find(p => p.badge_key === def.key);
          const pct = prog ? Math.min(100, (prog.current / prog.target) * 100) : 0;
          const rc = RARITY_CONFIG[def.rarity];

          return (
            <div
              key={def.key}
              className={`rounded-xl p-3 text-center border transition-all ${
                earned
                  ? `${rc.bg} ${rc.border} ${rc.glow}`
                  : 'bg-gray-50 border-gray-100'
              }`}
            >
              <p className="text-2xl">{earned ? def.icon : '🔒'}</p>
              <p className={`text-xs mt-1 font-medium leading-tight ${
                earned ? rc.color : 'text-gray-400'
              }`}>
                {def.label}
              </p>
              {earned && (
                <p className={`text-[10px] mt-0.5 font-bold uppercase ${rc.color} opacity-60`}>
                  {rc.label}
                </p>
              )}
              {!earned && prog && (
                <div className="mt-1">
                  <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-gray-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">{prog.current}/{prog.target}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
