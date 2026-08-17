'use client';
import { useEffect, useState, use as usePromise } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import {
  getStockReturn, approveStockReturn, rejectStockReturn, shipStockReturn, receiveStockReturn, cancelStockReturn,
  listProducts, type StockReturn, type StockReturnItem, type StockReturnStatus, type StockistProduct,
} from '@/lib/stockistApi';

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

export default function StockReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const { user } = useUser();

  const [stockReturn, setStockReturn] = useState<StockReturn | null>(null);
  const [items, setItems] = useState<StockReturnItem[]>([]);
  const [products, setProducts] = useState<StockistProduct[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      const [{ return: stockReturn, items }, { products }] = await Promise.all([getStockReturn(id), listProducts()]);
      setStockReturn(stockReturn);
      setItems(items);
      setProducts(products);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat detail retur');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [id]);

  async function run(action: () => Promise<unknown>, successMsg: string) {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await action();
      setSuccess(successMsg);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memproses retur');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault();
    await run(() => rejectStockReturn(id, rejectReason), 'Retur ditolak.');
    setShowRejectForm(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error && !stockReturn) {
    return (
      <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
        <span className="material-symbols-outlined">error</span>
        <span>{error}</span>
      </div>
    );
  }

  if (!stockReturn) return null;

  const isOwner = user?.role === 'owner';
  const productMap = new Map(products.map((p) => [p.id, p]));

  // Access already enforced server-side, same reasoning as the transfer and
  // request detail pages: reaching this point with data loaded means the
  // current user is authorized for this return.
  const canReview = isOwner && stockReturn.status === 'SUBMITTED';
  const canShip = stockReturn.status === 'APPROVED';
  const canReceive = isOwner && stockReturn.status === 'SHIPPED';
  const canCancel = stockReturn.status === 'SUBMITTED' || (isOwner && stockReturn.status === 'APPROVED');

  return (
    <div className="flex flex-col gap-5 animate-fade-in pb-12">
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.back()}
          className="w-10 h-10 flex items-center justify-center text-text-primary hover:bg-surface-elevated active:scale-95 transition-transform rounded-full -ml-2"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div>
          <h2 className="text-[20px] font-bold text-text-primary font-display">Detail Retur</h2>
          <p className="text-[11px] text-text-muted font-mono">NO: {stockReturn.return_number}</p>
        </div>
      </div>

      {success && (
        <div className="bg-success/10 border border-success text-success text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">check_circle</span>
          <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      <section className="bg-surface-elevated rounded-xl p-4 border border-border-base flex flex-col gap-3 shadow-sm">
        <div className="flex justify-between items-center border-b border-border-base pb-3">
          <h3 className="text-[13px] font-bold text-text-primary font-display flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-text-muted">storefront</span>
            {stockReturn.branch_name || stockReturn.branch_location_id}
          </h3>
          <span className={`px-2 py-0.5 rounded text-[9px] font-semibold border uppercase tracking-wider ${STATUS_STYLE[stockReturn.status]}`}>
            {STATUS_LABEL[stockReturn.status]}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Kategori</span>
          <p className="text-[13px] text-text-primary font-semibold">{CATEGORY_LABEL[stockReturn.category] || stockReturn.category}</p>
        </div>

        {stockReturn.reason && (
          <div className="flex flex-col gap-1">
            <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Catatan</span>
            <p className="text-[13px] text-text-primary">{stockReturn.reason}</p>
          </div>
        )}

        {stockReturn.status === 'REJECTED' && stockReturn.rejection_reason && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 flex flex-col gap-1">
            <span className="text-[9px] text-danger uppercase tracking-wider font-semibold">Alasan Penolakan</span>
            <p className="text-[13px] text-text-primary">{stockReturn.rejection_reason}</p>
          </div>
        )}

        {(stockReturn.category === 'RUSAK' || stockReturn.category === 'KEDALUWARSA') && (
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-2.5 flex items-center gap-2 text-[11px] text-warning">
            <span className="material-symbols-outlined text-[16px]">info</span>
            Barang kategori ini tidak akan masuk kembali ke stok jual gudang.
          </div>
        )}
      </section>

      <div className="flex items-center justify-between px-1">
        <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Daftar Produk</h3>
        <span className="text-[11px] text-text-secondary bg-surface-elevated px-2 py-0.5 rounded border border-border-base">{items.length} Item</span>
      </div>

      <div className="flex flex-col gap-3">
        {items.map((item) => {
          const product = productMap.get(item.product_id);
          return (
            <div key={item.id} className="bg-surface-elevated border border-border-base rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <h4 className="font-semibold text-text-primary text-[14px] leading-tight">{product?.name || 'Produk Tidak Dikenal'}</h4>
                <span className="text-[10px] text-text-muted mt-1 font-mono">SKU: {product?.sku || 'UNKNOWN'}</span>
              </div>
              <span className="text-[16px] font-bold text-text-primary font-display tabular-nums">
                {item.quantity} <span className="text-[11px] font-normal text-text-secondary">{product?.unit || 'pcs'}</span>
              </span>
            </div>
          );
        })}
      </div>

      {canReview && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => run(() => approveStockReturn(id), 'Retur disetujui.')}
            disabled={submitting}
            className="w-full bg-primary-container hover:bg-inverse-primary text-text-primary font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg border border-[#302728]"
          >
            <span className="material-symbols-outlined text-[18px]">verified</span>
            {submitting ? 'Memproses...' : 'Setujui Retur'}
          </button>
          <button
            type="button"
            onClick={() => setShowRejectForm((v) => !v)}
            className="w-full bg-surface-elevated border border-danger/40 text-danger font-semibold text-sm h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">cancel</span>
            Tolak Retur
          </button>
        </div>
      )}

      {canReview && showRejectForm && (
        <form onSubmit={handleReject} className="bg-surface-elevated border border-danger/30 rounded-xl p-4 flex flex-col gap-3">
          <label className="text-[11px] font-medium text-text-secondary">Alasan Penolakan *</label>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            required
            rows={3}
            placeholder="Mis: kategori retur tidak sesuai kondisi barang"
            className="w-full bg-[#171415] border border-border-base rounded-lg p-3 text-text-primary text-sm focus:outline-none focus:border-danger resize-none"
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-danger text-white font-bold text-sm h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all"
          >
            {submitting ? 'Memproses...' : 'Konfirmasi Tolak'}
          </button>
        </form>
      )}

      {canShip && (
        <button
          onClick={() => run(() => shipStockReturn(id), 'Barang dikirim ke gudang, stok cabang diperbarui.')}
          disabled={submitting}
          className="w-full bg-primary-container hover:bg-inverse-primary text-text-primary font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg border border-[#302728]"
        >
          <span className="material-symbols-outlined text-[18px]">local_shipping</span>
          {submitting ? 'Memproses...' : 'Kirim ke Gudang'}
        </button>
      )}

      {canReceive && (
        <button
          onClick={() => run(() => receiveStockReturn(id), 'Retur diterima gudang.')}
          disabled={submitting}
          className="w-full bg-primary-container hover:bg-inverse-primary text-text-primary font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg border border-[#302728]"
        >
          <span className="material-symbols-outlined text-[18px]">inventory</span>
          {submitting ? 'Memproses...' : 'Konfirmasi Diterima Gudang'}
        </button>
      )}

      {canCancel && (
        <button
          onClick={() => run(() => cancelStockReturn(id), 'Retur dibatalkan.')}
          disabled={submitting}
          className="w-full bg-surface-elevated border border-border-base text-text-secondary font-semibold text-sm h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
          {submitting ? 'Memproses...' : 'Batalkan Retur'}
        </button>
      )}
    </div>
  );
}
