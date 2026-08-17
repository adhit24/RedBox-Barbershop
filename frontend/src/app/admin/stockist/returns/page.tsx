'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { listStockReturns, type StockReturn, type StockReturnStatus } from '@/lib/stockistApi';

const STATUS_LABEL: Record<StockReturnStatus, string> = {
  SUBMITTED: 'Menunggu Persetujuan',
  APPROVED: 'Disetujui — Siap Kirim',
  REJECTED: 'Ditolak',
  SHIPPED: 'Dikirim ke Gudang',
  RECEIVED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

const STATUS_STYLE: Record<StockReturnStatus, string> = {
  SUBMITTED: 'bg-warning/10 border-warning/30 text-warning',
  APPROVED: 'bg-warning/10 border-warning/30 text-warning',
  REJECTED: 'bg-danger/10 border-danger/30 text-danger',
  SHIPPED: 'bg-danger/10 border-danger/30 text-danger',
  RECEIVED: 'bg-success/10 border-success/30 text-success',
  CANCELLED: 'bg-surface-container border-border-base text-text-muted',
};

const CATEGORY_LABEL: Record<string, string> = {
  RUSAK: 'Barang Rusak',
  KEDALUWARSA: 'Kedaluwarsa',
  SALAH_KIRIM: 'Salah Kirim',
  KELEBIHAN: 'Kelebihan Stok',
  LAINNYA: 'Lainnya',
};

export default function StockReturnsPage() {
  const { user } = useUser();
  const [returns, setReturns] = useState<StockReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | StockReturnStatus>('ALL');

  const isOwner = user?.role === 'owner';

  async function refresh() {
    setLoading(true);
    try {
      const { returns } = await listStockReturns();
      setReturns(returns);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar retur');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const filteredReturns = returns.filter((r) => statusFilter === 'ALL' || r.status === statusFilter);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Retur Barang</h2>
          <p className="text-[12px] text-text-muted mt-1">
            {isOwner ? 'Retur barang dari seluruh cabang.' : 'Ajukan retur barang rusak, salah kirim, atau kelebihan stok.'}
          </p>
        </div>
        {!isOwner && (
          <Link
            href="/admin/stockist/returns/new"
            className="flex items-center gap-1.5 px-3 py-2 bg-primary-container text-text-primary text-[12px] font-semibold rounded-lg hover:bg-inverse-primary transition-all active:scale-95 border border-[#302728]"
          >
            <span className="material-symbols-outlined text-[16px]">add_circle</span>
            Ajukan Retur
          </Link>
        )}
      </div>

      <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 shadow-sm">
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {(
            [
              ['ALL', 'Semua'], ['SUBMITTED', 'Menunggu'], ['APPROVED', 'Disetujui'],
              ['SHIPPED', 'Dikirim'], ['RECEIVED', 'Selesai'], ['REJECTED', 'Ditolak'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={`whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                statusFilter === value
                  ? 'bg-primary-container border-primary-container text-text-primary'
                  : 'bg-surface-container-low border-border-base text-text-secondary hover:border-text-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : (
        <section className="flex flex-col gap-3">
          {filteredReturns.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8 bg-surface-elevated border border-border-base rounded-xl">
              Belum ada retur barang.
            </p>
          ) : (
            filteredReturns.map((r) => (
              <Link
                href={`/admin/stockist/returns/${r.id}`}
                key={r.id}
                className="bg-surface-elevated border border-border-base p-4 rounded-xl flex flex-col gap-3 hover:border-primary-container active:scale-[0.98] transition-all"
              >
                <div className="flex justify-between items-start">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-text-muted font-mono leading-none">NO: {r.return_number}</span>
                    <h4 className="font-semibold text-text-primary text-[14px] leading-tight mt-1">
                      {isOwner ? (r.branch_name || r.branch_location_id) : (CATEGORY_LABEL[r.category] || r.category)}
                    </h4>
                    {isOwner && <span className="text-[10px] text-text-muted">{CATEGORY_LABEL[r.category] || r.category}</span>}
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-semibold border uppercase tracking-wider ${STATUS_STYLE[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>
                <div className="h-[1px] w-full bg-border-base/50"></div>
                <div className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                  <span className="material-symbols-outlined text-[14px] text-text-muted">calendar_today</span>
                  <span>{formatDate(r.created_at)}</span>
                </div>
              </Link>
            ))
          )}
        </section>
      )}
    </div>
  );
}
