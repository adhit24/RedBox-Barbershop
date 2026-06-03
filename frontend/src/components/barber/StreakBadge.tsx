import type { StreakData } from '@/lib/barberTypes';

export function StreakBadge({ streak }: { streak: StreakData }) {
  if (streak.current_streak === 0 && streak.longest_streak === 0) return null;
  return (
    <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-sm text-orange-600 font-medium">Streak</p>
          <p className="text-3xl font-bold text-orange-700">{streak.current_streak} hari</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Rekor</p>
          <p className="text-lg font-semibold text-gray-700">{streak.longest_streak} hari</p>
        </div>
      </div>
    </div>
  );
}
