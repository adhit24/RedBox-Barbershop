'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listProducts, getInventorySummary, type StockistProduct, type InventoryBalance } from '@/lib/stockistApi';

export interface LocationDrillDownContentProps {
  locationId: string;
  locationName: string;
}

interface SkuRow {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
}

const cache = new Map<string, SkuRow[]>();

export function LocationDrillDownContent({ locationId, locationName }: LocationDrillDownContentProps) {
  const [rows, setRows] = useState<SkuRow[] | null>(cache.get(locationId) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache.has(locationId)) {
      setRows(cache.get(locationId)!);
      return;
    }
    let cancelled = false;
    setRows(null);
    setError(null);
    Promise.all([listProducts(), getInventorySummary(locationId)])
      .then(([{ products }, { balances }]) => {
        if (cancelled) return;
        const productById = new Map<string, StockistProduct>(products.map((p) => [p.id, p]));
        const merged: SkuRow[] = balances
          .filter((b: InventoryBalance) => b.quantity > 0)
          .map((b: InventoryBalance) => {
            const product = productById.get(b.product_id);
            return {
              productId: b.product_id,
              name: product?.name ?? 'Produk tidak dikenal',
              sku: product?.sku ?? '-',
              quantity: b.quantity,
            };
          })
          .sort((a, b) => b.quantity - a.quantity);
        cache.set(locationId, merged);
        setRows(merged);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Gagal memuat rincian lokasi');
      });
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-danger text-[12px]">{error}</p>}
      {!rows && !error && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 bg-surface-container-high rounded-lg animate-pulse" />
          ))}
        </div>
      )}
      {rows && rows.length === 0 && <p className="text-text-muted text-[12px]">Tidak ada stok aktif di lokasi ini.</p>}
      {rows && rows.length > 0 && (
        <div className="flex flex-col divide-y divide-border-base">
          {rows.slice(0, 8).map((row) => (
            <div key={row.productId} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] text-text-primary truncate">{row.name}</span>
                <span className="text-[10px] text-text-muted font-mono">{row.sku}</span>
              </div>
              <span className="text-[13px] font-bold text-text-primary tabular-nums shrink-0">{row.quantity} pcs</span>
            </div>
          ))}
        </div>
      )}
      <Link
        href={`/admin/stockist/branch-stock?location=${locationId}`}
        className="mt-1 text-center text-[12px] font-semibold text-primary-container hover:underline"
      >
        Lihat semua stok di {locationName}
      </Link>
    </div>
  );
}
