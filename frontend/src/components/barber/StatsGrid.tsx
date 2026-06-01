import type { BarberStats } from '@/lib/barberTypes';

function rupiah(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}rb`;
  return String(n);
}

interface Props {
  stats: BarberStats;
}

export function StatsGrid({ stats }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <p className="text-2xl font-bold text-gray-900">👥 {stats.count}</p>
        <p className="text-xs text-gray-500 mt-1">Customer</p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <p className="text-2xl font-bold text-gray-900">💰 {rupiah(stats.revenue)}</p>
        <p className="text-xs text-gray-500 mt-1">Revenue</p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <p className="text-2xl font-bold text-gray-900">⏱️ {stats.hours}j</p>
        <p className="text-xs text-gray-500 mt-1">Jam Kerja</p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <p className="text-2xl font-bold text-gray-900">⭐ {stats.rating || '-'}</p>
        <p className="text-xs text-gray-500 mt-1">Rating</p>
      </div>
    </div>
  );
}
