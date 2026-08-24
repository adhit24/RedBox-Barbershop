// frontend/src/app/admin/stockist/warehouse/receive/page.tsx
'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Package } from 'lucide-react';
import { listProducts, getInventorySummary, receiveWarehouseStock, type StockistProduct } from '@/lib/stockistApi';
import { getKnownProductImage } from '@/lib/stockist/productImage';
import { Stepper } from '@/components/stockist/Stepper';
import { SuccessScreen } from '@/components/stockist/SuccessScreen';

function ReceiveStockContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectId = searchParams?.get('product') ?? '';

  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [currentStock, setCurrentStock] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState('');
  const [qty, setQty] = useState(24);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ productName: string; qty: number; after: number; note: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([listProducts(), getInventorySummary('warehouse')])
      .then(([{ products }, { balances }]) => {
        if (!mounted) return;
        const active = products.filter((p) => p.is_active);
        setProducts(active);
        setCurrentStock(Object.fromEntries(balances.map((b) => [b.product_id, b.quantity])));
        if (preselectId && active.some((p) => p.id === preselectId)) {
          setSelectedId(preselectId);
        } else if (active.length > 0) {
          setSelectedId(active[0].id);
        }
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat produk'))
      .finally(() => setLoading(false));
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = products.find((p) => p.id === selectedId);
  const before = selected ? (currentStock[selected.id] ?? 0) : 0;
  const after = before + qty;

  async function handleSubmit() {
    if (!selected) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await receiveWarehouseStock({ product_id: selected.id, quantity: qty, reason: note || undefined });
      setResult({ productName: selected.name, qty, after, note: note || '-' });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal menerima barang');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <SuccessScreen
        title="Barang berhasil diterima"
        body="Stok gudang pusat sudah diperbarui."
        summary={[
          { label: 'Produk', value: result.productName },
          { label: 'Quantity', value: `+${result.qty}` },
          { label: 'Stok akhir', value: String(result.after) },
          { label: 'Referensi', value: result.note },
        ]}
        secondaryAction={{ label: 'Lihat di Ledger', href: '/admin/stockist/ledger' }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in pb-12">
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push('/admin/stockist/warehouse')}
          className="w-10 h-10 flex items-center justify-center text-text-primary hover:bg-surface-elevated active:scale-95 transition-transform rounded-full -ml-2"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div>
          <h2 className="text-[20px] font-bold text-text-primary font-display">Terima Barang</h2>
          <p className="text-[12px] text-text-muted">Catat barang masuk ke gudang pusat.</p>
        </div>
      </div>

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
        <>
          <div className="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1">
            {products.map((p) => {
              const image = getKnownProductImage(p.name);
              const isSelected = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`flex w-[112px] shrink-0 flex-col items-center gap-1.5 rounded-xl border p-2.5 transition-colors ${
                    isSelected ? 'border-[1.5px] border-primary-container bg-tint-red' : 'border-border-base bg-surface-elevated'
                  }`}
                >
                  <div className="flex h-[70px] w-[70px] items-center justify-center overflow-hidden rounded-lg bg-surface-container-lowest">
                    {image ? (
                      <img src={image} alt={p.name} className="h-full w-full object-contain p-1" />
                    ) : (
                      <Package size={28} className="text-text-muted" aria-hidden />
                    )}
                  </div>
                  <span className="h-[29px] w-full overflow-hidden text-[11px] font-bold leading-[14.5px] text-text-primary">
                    {p.name}
                  </span>
                  <span className="text-[9px] font-mono text-text-muted">{p.sku}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col items-center gap-2 rounded-2xl border border-border-base bg-surface-elevated p-4">
            <span className="text-[11px] font-semibold text-text-muted">Quantity diterima</span>
            <Stepper value={qty} onChange={setQty} min={0} size="lg" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-text-secondary">Catatan / No. Invoice</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="INV/2026/08/1183"
              className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2.5 text-text-primary text-sm focus:outline-none focus:border-primary-container"
            />
          </div>

          {selected && (
            <div className="flex flex-col gap-2 rounded-xl border border-success bg-tint-success p-4">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-text-secondary">Stok saat ini</span>
                <span className="font-semibold text-text-primary">{before}</span>
              </div>
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-text-secondary">Quantity diterima</span>
                <span className="font-semibold text-success">+{qty}</span>
              </div>
              <div className="h-[1px] bg-border-base/60" />
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-text-primary">Stok setelah diterima</span>
                <span className="text-[20px] font-extrabold font-display tabular-nums text-text-primary">{after}</span>
              </div>
            </div>
          )}

          {submitError && (
            <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
              <span className="material-symbols-outlined">error</span>
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !selected}
              className="h-[52px] rounded-xl bg-primary-container text-white text-[14px] font-bold active:scale-95 transition-transform disabled:opacity-50"
            >
              {submitting ? 'Memproses...' : 'Terima Barang'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/admin/stockist/warehouse')}
              className="h-[48px] rounded-xl border border-border-base text-text-primary text-[14px] font-bold active:scale-95 transition-transform"
            >
              Batal
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ReceiveStockPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <ReceiveStockContent />
    </Suspense>
  );
}
