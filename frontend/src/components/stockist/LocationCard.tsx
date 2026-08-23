'use client';

import { motion } from 'framer-motion';
import { cardHover } from '@/lib/stockist/motion';
import type { AssetLocationSummary } from '@/lib/stockistApi';

export interface LocationCardProps {
  location: AssetLocationSummary;
  onSelect: () => void;
  formatValue: (value: number | null) => string;
  maxValue: number;
}

export function LocationCard({ location, onSelect, formatValue, maxValue }: LocationCardProps) {
  const rawPct = maxValue > 0 ? ((location.total_asset_value ?? 0) / maxValue) * 100 : 0;
  const pct = rawPct > 0 ? Math.max(4, Math.round(rawPct)) : 0;

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      {...cardHover}
      className="w-full flex flex-col gap-2 p-3 hover:bg-surface-container-high text-left"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-text-muted text-[18px]">
            {location.type === 'warehouse' ? 'warehouse' : 'storefront'}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-text-primary truncate">{location.location_name}</div>
            <div className="text-[10px] text-text-muted">
              {location.sku_count} SKU · {location.low_stock_count} perlu perhatian
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[13px] font-bold text-text-primary tabular-nums">{formatValue(location.total_asset_value)}</div>
          <div className="text-[10px] text-text-muted">{location.total_quantity.toLocaleString('id-ID')} unit</div>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
        <div className="h-full rounded-full bg-primary-container" style={{ width: `${pct}%` }} />
      </div>
    </motion.button>
  );
}
