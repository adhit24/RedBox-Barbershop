// frontend/src/components/barber/KingBadge.tsx
import type { KingData } from '@/lib/barberTypes';

export function KingBadge({ data }: { data: KingData }) {
  if (data.is_me) {
    return (
      <div className="bg-gradient-to-r from-yellow-400 to-amber-400 rounded-2xl px-4 py-3 text-center">
        <p className="font-bold text-white text-sm">King of The Shop</p>
        <p className="text-yellow-100 text-xs">{data.total_count} customer bulan ini</p>
      </div>
    );
  }
  return (
    <div className="bg-amber-50 rounded-2xl border border-amber-200 px-4 py-3 flex items-center gap-3">
      <div>
        <p className="text-xs text-amber-600 font-semibold">King of The Shop</p>
        <p className="font-bold text-amber-800 text-sm">{data.barber_name}</p>
        <p className="text-xs text-amber-600">{data.total_count} customer bulan ini</p>
      </div>
    </div>
  );
}
