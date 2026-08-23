'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { listStockOpnames, createStockOpname, type StockOpname, type StockOpnameStatus } from '@/lib/stockistApi';

const STATUS_LABEL: Record<StockOpnameStatus, string> = {
  DRAFT: 'Sedang Dihitung',
  SUBMITTED: 'Menunggu Persetujuan',
  APPROVED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

const STATUS_STYLE: Record<StockOpnameStatus, string> = {
  DRAFT: 'bg-surface-container border-border-base text-text-secondary',
  SUBMITTED: 'bg-warning/10 border-warning/30 text-warning',
  APPROVED: 'bg-success/10 border-success/30 text-success',
  CANCELLED: 'bg-surface-container border-border-base text-text-muted',
};

const BRANCHES = [
  { value: 'bypass', label: 'Cabang Bypass' },
  { value: 'sumber', label: 'Cabang Sumber' },
  { value: 'samadikun', label: 'Cabang Samadikun' },
  { value: 'csb', label: 'Cabang CSB Mall' },
  { value: 'tegal', label: 'Cabang Tegal' },
];

export default function StockOpnamePage() {
  const { user } = useUser();
  const router = useRouter();
  const [opnames, setOpnames] = useState<StockOpname[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [showStartForm, setShowStartForm] = useState(false);
  const [startLocation, setStartLocation] = useState<string>('warehouse');

  const isOwner = user?.role === 'owner';

  async function refresh() {
    setLoading(true);
    try {
      const { opnames } = await listStockOpnames();
      setOpnames(opnames);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar stock opname');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleStart() {
    setError(null);
    setStarting(true);
    try {
      const input = isOwner
        ? (startLocation === 'warehouse'
          ? { location_type: 'warehouse' as const }
          : { location_type: 'branch' as const, location_branch: startLocation })
        : { location_type: 'branch' as const, location_branch: user?.branch || '' };
      const { opname } = await createStockOpname(input);
      router.push(`/admin/stockist/stock-opname/${opname.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memulai stock opname');
      setStarting(false);
    }
  }

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
          <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Stock Opname</h2>
          <p className="text-[12px] text-text-muted mt-1">Hitung fisik dan koreksi selisih stok.</p>
        </div>
        <button
          onClick={() => isOwner ? setShowStartForm((v) => !v) : handleStart()}
          disabled={starting}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary-container text-white text-[12px] font-semibold rounded-lg hover:bg-inverse-primary transition-all active:scale-95"
        >
          <span className="material-symbols-outlined text-[16px]">{isOwner && showStartForm ? 'close' : 'add_task'}</span>
          {starting ? 'Memulai...' : isOwner && showStartForm ? 'Batal' : 'Mulai Opname'}
        </button>
      </div>

      {isOwner && showStartForm && (
        <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 shadow-sm animate-slide-up">
          <label className="text-[12px] font-semibold text-text-secondary">Pilih Lokasi</label>
          <select
            value={startLocation}
            onChange={(e) => setStartLocation(e.target.value)}
            className="w-full bg-[#171415] border border-border-base rounded-lg text-text-primary px-3 py-2.5 text-sm focus:outline-none focus:border-primary-container"
          >
            <option value="warehouse">Gudang Pusat</option>
            {BRANCHES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
          <button
            onClick={handleStart}
            disabled={starting}
            className="w-full bg-primary-container hover:bg-inverse-primary text-white font-bold text-sm h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all"
          >
            {starting ? 'Memulai...' : 'Mulai Hitung Stok'}
          </button>
        </section>
      )}

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
          {opnames.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8 bg-surface-elevated border border-border-base rounded-xl">
              Belum ada sesi stock opname.
            </p>
          ) : (
            opnames.map((o) => (
              <Link
                href={`/admin/stockist/stock-opname/${o.id}`}
                key={o.id}
                className="bg-surface-elevated border border-border-base p-4 rounded-xl flex flex-col gap-3 hover:border-primary-container active:scale-[0.98] transition-all"
              >
                <div className="flex justify-between items-start">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-text-muted font-mono leading-none">NO: {o.opname_number}</span>
                    <h4 className="font-semibold text-text-primary text-[14px] leading-tight mt-1">
                      {o.location_name || o.location_id}
                    </h4>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-semibold border uppercase tracking-wider ${STATUS_STYLE[o.status]}`}>
                    {STATUS_LABEL[o.status]}
                  </span>
                </div>
                <div className="h-[1px] w-full bg-border-base/50"></div>
                <div className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                  <span className="material-symbols-outlined text-[14px] text-text-muted">calendar_today</span>
                  <span>{formatDate(o.created_at)}</span>
                </div>
              </Link>
            ))
          )}
        </section>
      )}
    </div>
  );
}
