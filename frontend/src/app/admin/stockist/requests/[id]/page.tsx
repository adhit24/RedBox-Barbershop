'use client';
import { useEffect, useState, use as usePromise } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import {
  getStockRequest, approveStockRequest, rejectStockRequest, cancelStockRequest, fulfillStockRequest,
  listProducts, type StockRequest, type StockRequestItem, type StockRequestStatus, type StockistProduct,
} from '@/lib/stockistApi';

const STATUS_LABEL: Record<StockRequestStatus, string> = {
  SUBMITTED: 'Menunggu Persetujuan',
  APPROVED: 'Disetujui',
  PARTIALLY_APPROVED: 'Disetujui Sebagian',
  REJECTED: 'Ditolak',
  CANCELLED: 'Dibatalkan',
  FULFILLED: 'Selesai Dikirim',
};

const STATUS_STYLE: Record<StockRequestStatus, string> = {
  SUBMITTED: 'bg-warning/10 border-warning/30 text-warning',
  APPROVED: 'bg-success/10 border-success/30 text-success',
  PARTIALLY_APPROVED: 'bg-warning/10 border-warning/30 text-warning',
  REJECTED: 'bg-danger/10 border-danger/30 text-danger',
  CANCELLED: 'bg-surface-container border-border-base text-text-muted',
  FULFILLED: 'bg-success/10 border-success/30 text-success',
};

export default function StockRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const { user } = useUser();

  const [request, setRequest] = useState<StockRequest | null>(null);
  const [items, setItems] = useState<StockRequestItem[]>([]);
  const [products, setProducts] = useState<StockistProduct[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [approvedQty, setApprovedQty] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [{ request, items }, { products }] = await Promise.all([getStockRequest(id), listProducts()]);
      setRequest(request);
      setItems(items);
      setProducts(products);
      setApprovedQty(Object.fromEntries(items.map((i) => [i.id, String(i.quantity_approved ?? i.quantity_requested)])));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat detail permintaan');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [id]);

  async function handleApprove(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const payload = items.map((item) => ({ item_id: item.id, quantity_approved: Number(approvedQty[item.id] ?? 0) }));
      const { request } = await approveStockRequest(id, payload);
      setSuccess(request.status === 'APPROVED' ? 'Permintaan disetujui penuh.' : 'Permintaan disetujui sebagian.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyetujui permintaan');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await rejectStockRequest(id, rejectReason);
      setSuccess('Permintaan ditolak.');
      setShowRejectForm(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menolak permintaan');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!confirm('Batalkan permintaan ini?')) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await cancelStockRequest(id);
      setSuccess('Permintaan dibatalkan.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membatalkan permintaan');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFulfill() {
    if (!confirm('Kirim barang sesuai jumlah yang disetujui? Stok gudang akan berkurang setelah ini.')) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const { transfer } = await fulfillStockRequest(id);
      router.push(`/admin/stockist/transfers/${transfer.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim barang');
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error && !request) {
    return (
      <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
        <span className="material-symbols-outlined">error</span>
        <span>{error}</span>
      </div>
    );
  }

  if (!request) return null;

  const isOwner = user?.role === 'owner';
  const productMap = new Map(products.map((p) => [p.id, p]));

  const canReview = isOwner && request.status === 'SUBMITTED';
  const canFulfill = isOwner && (request.status === 'APPROVED' || request.status === 'PARTIALLY_APPROVED') && !request.fulfilling_transfer_id;
  const canCancel = !isOwner && request.status === 'SUBMITTED';

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
          <h2 className="text-[20px] font-bold text-text-primary font-display">Detail Permintaan</h2>
          <p className="text-[11px] text-text-muted font-mono">NO: {request.request_number}</p>
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
            {request.branch_name || request.branch_location_id}
          </h3>
          <span className={`px-2 py-0.5 rounded text-[9px] font-semibold border uppercase tracking-wider ${STATUS_STYLE[request.status]}`}>
            {STATUS_LABEL[request.status]}
          </span>
        </div>

        {request.reason && (
          <div className="flex flex-col gap-1">
            <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Alasan Permintaan</span>
            <p className="text-[13px] text-text-primary">{request.reason}</p>
          </div>
        )}

        {request.status === 'REJECTED' && request.rejection_reason && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 flex flex-col gap-1">
            <span className="text-[9px] text-danger uppercase tracking-wider font-semibold">Alasan Penolakan</span>
            <p className="text-[13px] text-text-primary">{request.rejection_reason}</p>
          </div>
        )}

        {request.fulfilling_transfer_id && (
          <button
            onClick={() => router.push(`/admin/stockist/transfers/${request.fulfilling_transfer_id}`)}
            className="text-xs text-primary-container hover:text-inverse-primary font-bold self-start flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">local_shipping</span>
            Lihat Transfer Pengiriman
          </button>
        )}
      </section>

      <form onSubmit={handleApprove} className="flex flex-col gap-4">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Daftar Produk</h3>
          <span className="text-[11px] text-text-secondary bg-surface-elevated px-2 py-0.5 rounded border border-border-base">
            {items.length} Item
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const product = productMap.get(item.product_id);
            const name = product?.name || 'Produk Tidak Dikenal';
            const sku = product?.sku || 'UNKNOWN';
            const unit = product?.unit || 'pcs';

            return (
              <div key={item.id} className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3">
                <div className="flex flex-col">
                  <h4 className="font-semibold text-text-primary text-[14px] leading-tight">{name}</h4>
                  <span className="text-[10px] text-text-muted mt-1 font-mono">SKU: {sku}</span>
                </div>

                <div className="flex justify-between items-center bg-surface-container-lowest p-3 rounded-lg border border-border-base text-center">
                  <div className="flex flex-col flex-1 items-start">
                    <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Diminta</span>
                    <span className="text-[14px] font-bold text-text-primary font-display tabular-nums mt-0.5">
                      {item.quantity_requested} <span className="text-[10px] font-normal text-text-secondary ml-0.5">{unit}</span>
                    </span>
                  </div>

                  <div className="w-[1px] h-8 bg-border-base"></div>

                  <div className="flex flex-col flex-1 items-center px-2">
                    <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold mb-0.5">Disetujui</span>
                    {canReview ? (
                      <input
                        type="number"
                        min={0}
                        max={item.quantity_requested}
                        value={approvedQty[item.id] ?? ''}
                        onChange={(e) => setApprovedQty({ ...approvedQty, [item.id]: e.target.value })}
                        className="w-16 h-[26px] bg-surface-container-lowest border border-border-base rounded text-center text-[12px] font-bold text-text-primary focus:outline-none focus:border-primary-container p-0"
                        required
                      />
                    ) : (
                      <span className="text-[14px] font-bold text-text-primary font-display tabular-nums mt-0.5">
                        {item.quantity_approved ?? '-'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {canReview && (
          <div className="flex flex-col gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-primary-container hover:bg-inverse-primary text-white font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg"
            >
              <span className="material-symbols-outlined text-[18px]">verified</span>
              {submitting ? 'Memproses...' : 'Setujui Permintaan'}
            </button>
            <button
              type="button"
              onClick={() => setShowRejectForm((v) => !v)}
              className="w-full bg-surface-elevated border border-danger/40 text-danger font-semibold text-sm h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">cancel</span>
              Tolak Permintaan
            </button>
          </div>
        )}
      </form>

      {canReview && showRejectForm && (
        <form onSubmit={handleReject} className="bg-surface-elevated border border-danger/30 rounded-xl p-4 flex flex-col gap-3">
          <label className="text-[11px] font-medium text-text-secondary">Alasan Penolakan *</label>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            required
            rows={3}
            placeholder="Mis: stok gudang tidak mencukupi minggu ini"
            className="w-full bg-surface-container-lowest border border-border-base rounded-lg p-3 text-text-primary text-sm focus:outline-none focus:border-danger resize-none"
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

      {canFulfill && (
        <button
          onClick={handleFulfill}
          disabled={submitting}
          className="w-full bg-primary-container hover:bg-inverse-primary text-white font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg"
        >
          <span className="material-symbols-outlined text-[18px]">local_shipping</span>
          {submitting ? 'Memproses...' : 'Kirim Barang Sekarang'}
        </button>
      )}

      {canCancel && (
        <button
          onClick={handleCancel}
          disabled={submitting}
          className="w-full bg-surface-elevated border border-border-base text-text-secondary font-semibold text-sm h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
          {submitting ? 'Memproses...' : 'Batalkan Permintaan'}
        </button>
      )}
    </div>
  );
}
