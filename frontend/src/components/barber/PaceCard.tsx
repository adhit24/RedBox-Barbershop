import type { PaceData } from '@/lib/barberTypes';

export function PaceCard({ pace }: { pace: PaceData }) {
  const pct = pace.target_monthly > 0 ? Math.min(100, (pace.current_count / pace.target_monthly) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      <p className="text-sm text-gray-500 mb-2">Pace Bulan Ini</p>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-2xl font-bold text-gray-900">{pace.current_count}</span>
        <span className="text-sm text-gray-500">/ {pace.target_monthly}</span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full transition-all ${pace.on_track ? 'bg-green-500' : 'bg-yellow-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>Sisa {pace.days_remaining} hari</span>
        <span>~{pace.needed_per_day}/hari</span>
      </div>
      <p className={`text-sm font-medium mt-2 ${pace.on_track ? 'text-green-600' : 'text-yellow-600'}`}>
        {pace.on_track
          ? `On track! Prediksi: ${pace.predicted_end} customer`
          : `Tambah ${Math.max(0, pace.needed_per_day - Math.round(pace.current_pace))}/hari lagi`
        }
      </p>
    </div>
  );
}
