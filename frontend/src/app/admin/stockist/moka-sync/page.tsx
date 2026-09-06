'use client';
import { useEffect, useState } from 'react';
import { getMokaSyncStatus, getMokaSyncAnomalies, type MokaSyncOutletStatus, type MokaSyncAnomaly } from '@/lib/stockistApi';
import { SkeletonCard } from '@/components/stockist/SkeletonCard';
import { EmptyState } from '@/components/stockist/EmptyState';

const STATUS_LABEL: Record<string, string> = {
  SUCCESS: 'Berhasil', PARTIAL: 'Perlu Perhatian', FAILED: 'Gagal', RUNNING: 'Berjalan',
};

const STATUS_TONE: Record<string, string> = {
  SUCCESS: 'text-success', PARTIAL: 'text-warning', FAILED: 'text-danger', RUNNING: 'text-info',
};

const ANOMALY_LABEL: Record<string, string> = {
  UNMAPPED_PRODUCT: 'Item Belum Dipetakan',
  UNKNOWN_VARIANT: 'Varian Belum Dipetakan',
  UNKNOWN_OUTLET: 'Outlet Tidak Dikenali',
  NEGATIVE_STOCK_RISK: 'Risiko Stok Negatif',
};

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'Belum pernah';
  const date = new Date(iso);
  return `${date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} · ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} WIB`;
}

export default function MokaSyncPage() {
  const [outlets, setOutlets] = useState<MokaSyncOutletStatus[]>([]);
  const [anomalies, setAnomalies] = useState<MokaSyncAnomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getMokaSyncStatus(), getMokaSyncAnomalies('OPEN')])
      .then(([status, anomalyData]) => {
        setOutlets(status.outlets);
        setAnomalies(anomalyData.anomalies);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat status sinkronisasi'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div>
        <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Sinkronisasi Moka</h2>
        <p className="text-[12px] text-text-muted mt-1">Status penarikan penjualan Moka ke Stockist per cabang.</p>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} className="min-h-[96px]" />)}
        </div>
      ) : outlets.length === 0 ? (
        <EmptyState icon="sync" title="Belum ada data sinkronisasi" subtitle="Sync Moka belum pernah berjalan untuk cabang manapun." />
      ) : (
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-bold text-text-primary px-1">Per Cabang</h3>
          {outlets.map((o) => (
            <div key={o.outlet_id} className="bg-surface-elevated border border-border-base rounded-xl p-3.5 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-text-primary">{o.outlet_name}</span>
                <span className={`text-[11px] font-semibold ${o.last_status ? STATUS_TONE[o.last_status] : 'text-text-muted'}`}>
                  {o.last_status ? STATUS_LABEL[o.last_status] : 'Belum sync'}
                </span>
              </div>
              <div className="text-[11px] text-text-muted">Last Sync: {formatSyncTime(o.last_successful_sync_at)}</div>
              <div className="grid grid-cols-4 gap-2 text-center pt-1">
                <div>
                  <div className="text-[14px] font-bold text-text-primary tabular-nums">{o.sales_fetched}</div>
                  <div className="text-[9px] text-text-muted uppercase tracking-wide">Ditarik</div>
                </div>
                <div>
                  <div className="text-[14px] font-bold text-text-primary tabular-nums">{o.sales_applied}</div>
                  <div className="text-[9px] text-text-muted uppercase tracking-wide">Diproses</div>
                </div>
                <div>
                  <div className={`text-[14px] font-bold tabular-nums ${o.unmapped_items > 0 ? 'text-warning' : 'text-text-primary'}`}>{o.unmapped_items}</div>
                  <div className="text-[9px] text-text-muted uppercase tracking-wide">Unmapped</div>
                </div>
                <div>
                  <div className={`text-[14px] font-bold tabular-nums ${o.open_anomalies > 0 ? 'text-danger' : 'text-text-primary'}`}>{o.open_anomalies}</div>
                  <div className="text-[9px] text-text-muted uppercase tracking-wide">Anomali</div>
                </div>
              </div>
              {o.last_error && (
                <div className="text-[11px] text-danger truncate pt-1 border-t border-border-base">Error: {o.last_error}</div>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-bold text-text-primary px-1">Antrean Anomali</h3>
        {!loading && anomalies.length === 0 ? (
          <EmptyState icon="check_circle" title="Tidak ada anomali terbuka" subtitle="Semua transaksi Moka termapping dan stok mencukupi." />
        ) : (
          <div className="flex flex-col gap-2">
            {anomalies.map((a) => (
              <div key={a.id} className="bg-surface-elevated border border-border-base rounded-xl p-3 flex flex-col gap-1.5">
                <div className="flex justify-between items-start gap-3">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-danger">{ANOMALY_LABEL[a.anomaly_type] || a.anomaly_type}</span>
                  <span className="text-[10px] text-text-muted shrink-0">{new Date(a.created_at).toLocaleString('id-ID')}</span>
                </div>
                <span className="text-[13px] font-semibold text-text-primary">{a.outlet_name}</span>
                {a.product_name && <span className="text-[12px] text-text-secondary">{a.product_name}</span>}
                {a.moka_item_id && !a.product_name && (
                  <span className="text-[12px] text-text-secondary font-mono">Moka item: {a.moka_item_id}{a.moka_variant_id ? ` / ${a.moka_variant_id}` : ''}</span>
                )}
                {(a.requested_quantity != null || a.available_quantity != null) && (
                  <span className="text-[11px] text-text-muted">
                    Diminta: {a.requested_quantity ?? '-'} · Tersedia: {a.available_quantity ?? '-'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
