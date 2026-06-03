// frontend/src/components/barber/XPBar.tsx
import type { XPData, TitleData } from '@/lib/barberTypes';

interface Props {
  xp: XPData;
  title: TitleData;
}

export function XPBar({ xp, title }: Props) {
  const pct = xp.xp_to_next_level > 0
    ? Math.min(100, Math.round((xp.current_xp / xp.xp_to_next_level) * 100))
    : 100;

  const levelColor =
    xp.level >= 40 ? 'from-rose-400 to-orange-400' :
    xp.level >= 30 ? 'from-red-500 to-rose-500' :
    xp.level >= 20 ? 'from-orange-400 to-amber-400' :
    xp.level >= 15 ? 'from-purple-500 to-indigo-500' :
    xp.level >= 10 ? 'from-blue-500 to-cyan-500' :
    xp.level >= 5  ? 'from-green-400 to-teal-400' :
                     'from-gray-400 to-gray-500';

  return (
    <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">
            Level {xp.level}{xp.prestige > 0 ? ` · ${'★'.repeat(xp.prestige)} Prestige` : ''}
          </p>
          <p className="font-bold text-gray-800 text-sm">{title.active_title}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">{xp.current_xp.toLocaleString()} / {xp.xp_to_next_level.toLocaleString()} XP</p>
          <p className="text-xs font-semibold text-gray-600">{pct}%</p>
        </div>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${levelColor} transition-all duration-500 rounded-full`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
