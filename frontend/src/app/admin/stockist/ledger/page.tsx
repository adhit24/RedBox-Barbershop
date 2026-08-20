'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { getInventoryLedger, listProducts, type InventoryLedgerEntry } from '@/lib/stockistApi';
import { SkeletonCard } from '@/components/stockist/SkeletonCard';
import { EmptyState } from '@/components/stockist/EmptyState';

const MOVEMENT_LABELS: Record<string, string> = {
  WAREHOUSE_RECEIVE: 'Barang Masuk Gudang',
  TRANSFER_OUT: 'Transfer Keluar',
  TRANSFER_IN: 'Transfer Masuk',
  ADJUSTMENT: 'Penyesuaian',
  RETURN_TO_CENTER: 'Retur ke Pusat',
  SALE_MOKA: 'Penjualan (Moka)',
  SALE_RETAIL: 'Penjualan Retail',
  SERVICE_OPEN: 'Pemakaian',
  SERVICE_FINISHED: 'Barang Ditandai Habis',
  STOCK_OPNAME_GAIN: 'Selisih Opname (Lebih)',
  STOCK_OPNAME_LOSS: 'Selisih Opname (Kurang)',
  DAMAGE: 'Kerusakan',
  LOST: 'Kehilangan',
};

export default function RiwayatPage() {
  const { user } = useUser();
  const [ledger, setLedger] = useState<InventoryLedgerEntry[]>([]);
  const [productNameById, setProductNameById] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getInventoryLedger(), listProducts()])
      .then(([{ ledger }, { products }]) => {
        setLedger(ledger);
        setProductNameById(new Map(products.map((p) => [p.id, p.name])));
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat riwayat'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div>
        <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Riwayat</h2>
        <p className="text-[12px] text-text-muted mt-1">
          {user?.role === 'owner' ? 'Seluruh pergerakan stok' : 'Pergerakan stok cabang Anda'}
        </p>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} className="min-h-[64px]" />)}
        </div>
      ) : ledger.length === 0 ? (
        <EmptyState icon="history" title="Belum ada riwayat" subtitle="Pergerakan stok akan muncul di sini." />
      ) : (
        <div className="flex flex-col gap-2">
          {ledger.map((entry) => (
            <div key={entry.id} className="bg-surface-elevated border border-border-base rounded-xl p-3 flex flex-col gap-2">
              <div className="flex justify-between items-start gap-3">
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-text-secondary">{MOVEMENT_LABELS[entry.movement_type] || entry.movement_type}</span>
                  <span className="text-[13px] font-semibold text-text-primary mt-0.5 truncate">{productNameById.get(entry.product_id) || entry.product_id}</span>
                </div>
                <span className={`text-[15px] font-bold tabular-nums shrink-0 font-display ${entry.quantity_delta < 0 ? 'text-danger' : 'text-success'}`}>
                  {entry.quantity_delta > 0 ? '+' : ''}{entry.quantity_delta}
                </span>
              </div>

              {(entry.quantity_before != null && entry.quantity_after != null) && (
                <div className="text-[11px] text-text-secondary tabular-nums">
                  Stok: {entry.quantity_before} → {entry.quantity_after}
                </div>
              )}

              {entry.reason && (
                <div className="text-[11px] text-text-secondary truncate">Alasan: {entry.reason}</div>
              )}

              <div className="flex items-center justify-between gap-3 pt-1 border-t border-border-base">
                <span className="text-[10px] text-text-muted">{new Date(entry.created_at).toLocaleString('id-ID')}</span>
                {entry.reference_type && entry.reference_id && (
                  <span className="text-[10px] text-text-muted font-mono truncate">Ref: {entry.reference_type} #{entry.reference_id.slice(0, 8)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
