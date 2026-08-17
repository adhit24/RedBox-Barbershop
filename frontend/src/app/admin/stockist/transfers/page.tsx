'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { listTransfers, type StockTransfer } from '@/lib/stockistApi';

export default function TransfersPage() {
  const { user } = useUser();
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SENT' | 'RECEIVED'>('ALL');

  async function refresh() {
    setLoading(true);
    try {
      const { transfers } = await listTransfers();
      setTransfers(transfers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar transfer');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const isOwner = user?.role === 'owner';

  // Filter transfers
  const filteredTransfers = transfers.filter((t) => {
    const sourceName = t.source_name || t.source_location_id;
    const destName = t.destination_name || t.destination_location_id;
    const matchesSearch = t.transfer_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          destName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          sourceName.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'ALL' || t.status === statusFilter;

    // Branch scoping already happened server-side (GET /transfers only returns
    // this branch_admin's own transfers) — `user.branch` is a slug like
    // "bypass", never the transfer's location UUID, so comparing them here
    // would incorrectly filter out every transfer for non-owner users.
    return matchesSearch && matchesStatus;
  });

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Header Area */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Transfer Stok</h2>
          <p className="text-[12px] text-text-muted mt-1">Status pengiriman barang antar cabang.</p>
        </div>
        {isOwner && (
          <Link
            href="/admin/stockist/transfers/new"
            className="flex items-center gap-1.5 px-3 py-2 bg-primary-container text-text-primary text-[12px] font-semibold rounded-lg hover:bg-inverse-primary transition-all active:scale-95 border border-[#302728]"
          >
            <span className="material-symbols-outlined text-[16px]">add_shopping_cart</span>
            Buat Transfer
          </Link>
        )}
      </div>

      {/* Search & Filter section */}
      <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 shadow-sm">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Cari nomor transfer atau cabang..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#171415] border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted transition-colors"
          />
        </div>

        {/* Filter chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${
              statusFilter === 'ALL'
                ? 'bg-primary-container border-primary-container text-text-primary'
                : 'bg-surface-container-low border-border-base text-text-secondary hover:border-text-muted'
            }`}
          >
            Semua
          </button>
          <button
            onClick={() => setStatusFilter('SENT')}
            className={`whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${
              statusFilter === 'SENT'
                ? 'bg-danger/15 border-danger/40 text-danger'
                : 'bg-surface-container-low border-border-base text-text-secondary hover:border-text-muted'
            }`}
          >
            Dikirim
          </button>
          <button
            onClick={() => setStatusFilter('RECEIVED')}
            className={`whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${
              statusFilter === 'RECEIVED'
                ? 'bg-success/15 border-success/40 text-success'
                : 'bg-surface-container-low border-border-base text-text-secondary hover:border-text-muted'
            }`}
          >
            Diterima
          </button>
        </div>
      </section>

      {/* Listings */}
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
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Riwayat Transfer</h3>
            <span className="text-[11px] text-text-muted">
              {filteredTransfers.length} Transaksi
            </span>
          </div>

          {filteredTransfers.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8 bg-surface-elevated border border-border-base rounded-xl">
              Tidak ada riwayat transfer stok.
            </p>
          ) : (
            filteredTransfers.map((t) => (
              <Link 
                href={`/admin/stockist/transfers/${t.id}`}
                key={t.id} 
                className="bg-surface-elevated border border-border-base p-4 rounded-xl flex flex-col gap-3 hover:border-primary-container active:scale-[0.98] transition-all"
              >
                <div className="flex justify-between items-start">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-text-muted font-mono leading-none">NO: {t.transfer_number}</span>
                    <h4 className="font-semibold text-text-primary text-[14px] leading-tight mt-1 flex items-center gap-1.5">
                      <span className="text-text-muted text-xs font-normal">{t.source_name || t.source_location_id}</span>
                      <span className="material-symbols-outlined text-[14px] text-text-muted">arrow_forward</span>
                      <span>{t.destination_name || t.destination_location_id}</span>
                    </h4>
                  </div>

                  <span className={`px-2 py-0.5 rounded text-[9px] font-semibold border uppercase tracking-wider ${
                    t.status === 'SENT' 
                      ? 'bg-danger/10 border-danger/30 text-danger' 
                      : 'bg-success/10 border-success/30 text-success'
                  }`}>
                    {t.status === 'SENT' ? 'Dikirim' : 'Diterima'}
                  </span>
                </div>

                <div className="h-[1px] w-full bg-border-base/50"></div>

                <div className="flex justify-between items-center text-[11px] text-text-secondary">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px] text-text-muted">calendar_today</span>
                    <span>{formatDate(t.sent_at)}</span>
                  </div>
                  <span className="text-[10px] text-text-muted font-medium">
                    Oleh: {t.sent_by}
                  </span>
                </div>
              </Link>
            ))
          )}
        </section>
      )}
    </div>
  );
}
