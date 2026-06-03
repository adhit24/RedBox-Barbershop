// frontend/src/components/barber/RivalWidget.tsx
import type { RivalData } from '@/lib/barberTypes';

export function RivalWidget({ data }: { data: RivalData }) {
  const gap = data.gap;
  const isWinning = gap > 0;
  const isTied = gap === 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">⚔️ Rival Minggu Ini</p>
      <div className="flex items-center justify-between">
        <div>
          <p className="font-bold text-gray-800">{data.rival_name}</p>
          <p className="text-xs text-gray-400 capitalize">{data.rival_branch}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-gray-700">
            {data.my_count} <span className="text-gray-300 font-normal">vs</span> {data.rival_count}
          </p>
          <p className={`text-xs font-semibold mt-0.5 ${
            isWinning ? 'text-green-600' : isTied ? 'text-gray-500' : 'text-red-500'
          }`}>
            {isWinning ? `+${gap} customer unggul` :
             isTied ? 'Sejajar' :
             `${Math.abs(gap)} customer tertinggal`}
          </p>
        </div>
      </div>
    </div>
  );
}
