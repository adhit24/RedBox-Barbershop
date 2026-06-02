import type { MissionsResponse } from '@/lib/barberTypes';
import { MISSION_LABELS } from '@/lib/achievementDefs';

export function MissionList({ data }: { data: MissionsResponse }) {
  if (data.missions.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-sm">
        Belum ada misi minggu ini. Misi baru di-generate tiap Senin pagi.
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-3">🎯 Misi Minggu Ini</p>
      <div className="space-y-3">
        {data.missions.map(m => {
          const def = MISSION_LABELS[m.mission_key] || { label: m.mission_key, icon: '🎯' };
          const pct = m.target > 0 ? Math.min(100, (m.progress / m.target) * 100) : 0;
          const done = !!m.completed_at;

          return (
            <div key={m.mission_key} className={`bg-white rounded-xl p-3 border ${done ? 'border-green-200 bg-green-50' : 'border-gray-100'}`}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium">
                  {done ? '✅' : def.icon} {def.label}
                </span>
                <span className="text-xs text-gray-500">{m.progress}/{m.target}</span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${done ? 'bg-green-500' : 'bg-red-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
