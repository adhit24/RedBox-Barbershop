import type { AchievementsResponse } from '@/lib/barberTypes';
import { BADGE_DEFS } from '@/lib/achievementDefs';

export function BadgeGrid({ data }: { data: AchievementsResponse }) {
  const earnedKeys = new Set(data.earned.map(e => e.badge_key));

  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-3">🏅 Badges</p>
      <div className="grid grid-cols-3 gap-2">
        {BADGE_DEFS.map(def => {
          const earned = earnedKeys.has(def.key);
          const prog = data.in_progress.find(p => p.badge_key === def.key);
          const pct = prog ? Math.min(100, (prog.current / prog.target) * 100) : 0;

          return (
            <div
              key={def.key}
              className={`rounded-xl p-3 text-center border ${
                earned ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-100'
              }`}
            >
              <p className="text-2xl">{earned ? def.icon : '🔒'}</p>
              <p className={`text-xs mt-1 font-medium ${earned ? 'text-yellow-800' : 'text-gray-400'}`}>
                {def.label}
              </p>
              {!earned && prog && (
                <div className="mt-1">
                  <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-gray-400" style={{ width: `${pct}%` }} />
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
