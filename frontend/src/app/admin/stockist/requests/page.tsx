'use client';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { listStockRequests, type StockRequest, type StockRequestStatus } from '@/lib/stockistApi';

const STATUS_LABEL: Record<StockRequestStatus, string> = {
  SUBMITTED: 'Menunggu Persetujuan',
  APPROVED: 'Disetujui',
  PARTIALLY_APPROVED: 'Disetujui Sebagian',
  REJECTED: 'Ditolak',
  CANCELLED: 'Dibatalkan',
  FULFILLED: 'Selesai',
};

const STATUS_STYLE: Record<StockRequestStatus, string> = {
  SUBMITTED: 'bg-warning/10 border-warning/30 text-warning',
  APPROVED: 'bg-success/10 border-success/30 text-success',
  PARTIALLY_APPROVED: 'bg-warning/10 border-warning/30 text-warning',
  REJECTED: 'bg-danger/10 border-danger/30 text-danger',
  CANCELLED: 'bg-surface-container border-border-base text-text-muted',
  FULFILLED: 'bg-success/10 border-success/30 text-success',
};

function StockRequestsContent() {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const initialStatus = searchParams?.get('status');
  const isValidInitialStatus = initialStatus === 'NEEDS_ACTION' ||
    ['SUBMITTED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'CANCELLED', 'FULFILLED'].includes(initialStatus || '');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'NEEDS_ACTION' | StockRequestStatus>(
    isValidInitialStatus ? (initialStatus as 'NEEDS_ACTION' | StockRequestStatus) : 'ALL'
  );

  async function refresh() {
    setLoading(true);
    try {
      const { requests } = await listStockRequests();
      setRequests(requests);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar permintaan');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const isOwner = user?.role === 'owner';

  const filteredRequests = requests.filter((r) => {
    const matchesSearch = r.request_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.branch_name || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' ||
      (statusFilter === 'NEEDS_ACTION' ? r.status === 'SUBMITTED' : r.status === statusFilter);
    return matchesSearch && matchesStatus;
  });

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
          <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Permintaan Stok</h2>
          <p className="text-[12px] text-text-muted mt-1">
            {isOwner ? 'Permintaan restock dari seluruh cabang.' : 'Ajukan dan pantau permintaan stok cabang Anda.'}
          </p>
        </div>
        {!isOwner && (
          <Link
            href="/admin/stockist/requests/new"
            className="flex items-center gap-1.5 px-3 py-2 bg-primary-container text-text-primary text-[12px] font-semibold rounded-lg hover:bg-inverse-primary transition-all active:scale-95 border border-[#302728]"
          >
            <span className="material-symbols-outlined text-[16px]">add_circle</span>
            Ajukan
          </Link>
        )}
      </div>

      <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 shadow-sm">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Cari nomor permintaan atau cabang..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#171415] border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted transition-colors"
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {(
            [
              ['ALL', 'Semua'],
              ...(isOwner ? [['NEEDS_ACTION', 'Perlu Ditinjau']] as const : []),
              ['SUBMITTED', 'Menunggu'],
              ['APPROVED', 'Disetujui'],
              ['FULFILLED', 'Selesai'],
              ['REJECTED', 'Ditolak'],
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
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Riwayat Permintaan</h3>
            <span className="text-[11px] text-text-muted">{filteredRequests.length} Transaksi</span>
          </div>

          {filteredRequests.length === 0 ? (
            <div className="text-center text-text-muted text-sm py-8 bg-surface-elevated border border-border-base rounded-xl flex flex-col gap-1">
              <p>Belum ada permintaan stok.</p>
              {!isOwner && <p className="text-[11px]">Ajukan permintaan restock pertama Anda.</p>}
            </div>
          ) : (
            filteredRequests.map((r) => (
              <Link
                href={`/admin/stockist/requests/${r.id}`}
                key={r.id}
                className="bg-surface-elevated border border-border-base p-4 rounded-xl flex flex-col gap-3 hover:border-primary-container active:scale-[0.98] transition-all"
              >
                <div className="flex justify-between items-start">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-text-muted font-mono leading-none">NO: {r.request_number}</span>
                    <h4 className="font-semibold text-text-primary text-[14px] leading-tight mt-1">
                      {isOwner ? (r.branch_name || r.branch_location_id) : (r.reason || 'Permintaan restock')}
                    </h4>
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

export default function StockRequestsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <StockRequestsContent />
    </Suspense>
  );
}
