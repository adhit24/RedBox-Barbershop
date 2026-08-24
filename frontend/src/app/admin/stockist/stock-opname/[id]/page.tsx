'use client';
import { useEffect, useState, use as usePromise } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import {
  getStockOpname, countStockOpname, submitStockOpname, approveStockOpname, cancelStockOpname,
  listProducts, type StockOpname, type StockOpnameItem, type StockOpnameStatus, type StockistProduct,
} from '@/lib/stockistApi';

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

export default function StockOpnameDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const { user } = useUser();

  const [opname, setOpname] = useState<StockOpname | null>(null);
  const [items, setItems] = useState<StockOpnameItem[]>([]);
  const [products, setProducts] = useState<StockistProduct[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [physicalInputs, setPhysicalInputs] = useState<Record<string, string>>({});
  const [reasonInputs, setReasonInputs] = useState<Record<string, string>>({});

  async function refresh() {
    setLoading(true);
    try {
      const [{ opname, items }, { products }] = await Promise.all([getStockOpname(id), listProducts()]);
      setOpname(opname);
      setItems(items);
      setProducts(products);
      setPhysicalInputs(Object.fromEntries(items.map((i) => [i.id, i.physical_quantity != null ? String(i.physical_quantity) : ''])));
      setReasonInputs(Object.fromEntries(items.map((i) => [i.id, i.reason || ''])));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat detail stock opname');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [id]);

  async function handleSaveCounts() {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const payload = items
        .filter((item) => physicalInputs[item.id] !== '' && physicalInputs[item.id] !== undefined)
        .map((item) => ({
          item_id: item.id,
          physical_quantity: Number(physicalInputs[item.id]),
          reason: reasonInputs[item.id]?.trim() || undefined,
        }));
      if (payload.length === 0) throw new Error('Isi minimal satu jumlah fisik sebelum menyimpan');
      await countStockOpname(id, payload);
      setSuccess('Hitungan tersimpan.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan hitungan');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    if (!confirm('Kirim hasil hitungan untuk persetujuan? Pastikan seluruh jumlah fisik sudah benar.')) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await submitStockOpname(id);
      setSuccess('Hasil hitungan dikirim untuk persetujuan.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim hasil hitungan');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove() {
    if (!confirm('Setujui stock opname ini? Selisih akan langsung menyesuaikan stok sistem dan tidak bisa dibatalkan.')) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await approveStockOpname(id);
      setSuccess('Stock opname disetujui, stok telah disesuaikan.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyetujui stock opname');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!confirm('Batalkan sesi stock opname ini?')) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await cancelStockOpname(id);
      setSuccess('Stock opname dibatalkan.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membatalkan stock opname');
    } finally {
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

  if (error && !opname) {
    return (
      <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
        <span className="material-symbols-outlined">error</span>
        <span>{error}</span>
      </div>
    );
  }

  if (!opname) return null;

  const isOwner = user?.role === 'owner';
  const productMap = new Map(products.map((p) => [p.id, p]));

  // Access is already enforced server-side (GET 403s a branch_admin whose
  // branch doesn't own this location), so reaching this point with a loaded
  // `opname` means the current user is authorized for it.
  const canCount = opname.status === 'DRAFT';
  const canCancel = opname.status === 'DRAFT' || (isOwner && opname.status === 'SUBMITTED');
  const canApprove = isOwner && opname.status === 'SUBMITTED';

  const discrepancyCount = items.filter((i) => (i.difference ?? 0) !== 0).length;

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
          <h2 className="text-[20px] font-bold text-text-primary font-display">Stock Opname</h2>
          <p className="text-[11px] text-text-muted font-mono">NO: {opname.opname_number}</p>
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
        <div className="flex justify-between items-center">
          <h3 className="text-[13px] font-bold text-text-primary font-display flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-text-muted">storefront</span>
            {opname.location_name || opname.location_id}
          </h3>
          <span className={`px-2 py-0.5 rounded text-[9px] font-semibold border uppercase tracking-wider ${STATUS_STYLE[opname.status]}`}>
            {STATUS_LABEL[opname.status]}
          </span>
        </div>
        {opname.status !== 'DRAFT' && (
          <div className="flex items-center gap-1.5 text-[12px] text-text-secondary">
            <span className="material-symbols-outlined text-[16px] text-text-muted">fact_check</span>
            {discrepancyCount > 0 ? `${discrepancyCount} produk dengan selisih` : 'Tidak ada selisih'}
          </div>
        )}
      </section>

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
          const accountedQuantity = item.total_accounted_quantity ?? item.system_quantity;
          const liveDiff = physicalInputs[item.id] !== '' && physicalInputs[item.id] !== undefined
            ? Number(physicalInputs[item.id]) - accountedQuantity
            : item.difference;

          return (
            <div key={item.id} className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3">
              <div className="flex flex-col">
                <h4 className="font-semibold text-text-primary text-[14px] leading-tight">{name}</h4>
                <span className="text-[10px] text-text-muted mt-1 font-mono">SKU: {sku}</span>
              </div>

              <div className="flex justify-between items-center bg-surface-container-lowest p-3 rounded-lg border border-border-base text-center">
                <div className="flex flex-col flex-1 items-start">
                  <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Available</span>
                  <span className="text-[14px] font-bold text-text-primary font-display tabular-nums mt-0.5">
                    {item.system_quantity} <span className="text-[10px] font-normal text-text-secondary ml-0.5">{unit}</span>
                  </span>
                  <span className="text-[9px] text-accent-soft mt-1">In Use: {item.in_use_quantity ?? 0}</span>
                </div>
                <div className="w-[1px] h-8 bg-border-base"></div>
                <div className="flex flex-col flex-1 items-center px-2">
                  <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold mb-0.5">Fisik</span>
                  {canCount ? (
                    <input
                      type="number"
                      min={0}
                      value={physicalInputs[item.id] ?? ''}
                      onChange={(e) => setPhysicalInputs({ ...physicalInputs, [item.id]: e.target.value })}
                      className="w-16 h-[26px] bg-surface-container-lowest border border-border-base rounded text-center text-[12px] font-bold text-text-primary focus:outline-none focus:border-primary-container p-0"
                    />
                  ) : (
                    <span className="text-[14px] font-bold text-text-primary font-display tabular-nums mt-0.5">
                      {item.physical_quantity ?? '-'}
                    </span>
                  )}
                </div>
                <div className="w-[1px] h-8 bg-border-base"></div>
                <div className="flex flex-col flex-1 items-end">
                  <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Selisih</span>
                  <span className={`text-[14px] font-bold font-display tabular-nums mt-0.5 ${
                    liveDiff != null && liveDiff < 0 ? 'text-danger' : liveDiff != null && liveDiff > 0 ? 'text-success' : 'text-text-muted'
                  }`}>
                    {liveDiff == null ? '-' : liveDiff > 0 ? `+${liveDiff}` : liveDiff}
                  </span>
                </div>
              </div>

              {canCount && !!physicalInputs[item.id] && Number(physicalInputs[item.id]) !== item.system_quantity && (
                <input
                  value={reasonInputs[item.id] ?? ''}
                  onChange={(e) => setReasonInputs({ ...reasonInputs, [item.id]: e.target.value })}
                  placeholder="Alasan selisih (wajib sebelum dikirim)"
                  className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary text-[12px] focus:outline-none focus:border-primary-container"
                />
              )}

              {!canCount && item.reason && (
                <p className="text-[11px] text-text-secondary bg-surface-container-lowest rounded-lg p-2 border border-border-base">
                  Alasan: {item.reason}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {canCount && (
        <div className="flex flex-col gap-2">
          <button
            onClick={handleSaveCounts}
            disabled={submitting}
            className="w-full bg-surface-elevated border border-border-base text-text-primary font-semibold text-sm h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">save</span>
            {submitting ? 'Menyimpan...' : 'Simpan Hitungan'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full bg-primary-container hover:bg-inverse-primary text-white font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg"
          >
            <span className="material-symbols-outlined text-[18px]">send</span>
            {submitting ? 'Memproses...' : 'Kirim untuk Persetujuan'}
          </button>
        </div>
      )}

      {canApprove && (
        <button
          onClick={handleApprove}
          disabled={submitting}
          className="w-full bg-primary-container hover:bg-inverse-primary text-white font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg"
        >
          <span className="material-symbols-outlined text-[18px]">verified</span>
          {submitting ? 'Memproses...' : 'Setujui & Sesuaikan Stok'}
        </button>
      )}

      {canCancel && (
        <button
          onClick={handleCancel}
          disabled={submitting}
          className="w-full bg-surface-elevated border border-danger/40 text-danger font-semibold text-sm h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
          {submitting ? 'Memproses...' : 'Batalkan Opname'}
        </button>
      )}
    </div>
  );
}
