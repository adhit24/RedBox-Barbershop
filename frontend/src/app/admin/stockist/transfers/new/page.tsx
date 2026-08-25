// frontend/src/app/admin/stockist/transfers/new/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { listProducts, getInventorySummary, createTransfer, type StockistProduct } from '@/lib/stockistApi';
import { getKnownProductImage } from '@/lib/stockist/productImage';
import { Stepper } from '@/components/stockist/Stepper';
import { SuccessScreen } from '@/components/stockist/SuccessScreen';
import { useDraftPersistence } from '@/hooks/useDraftPersistence';
import { showToast } from '@/lib/stockist/useToast';

const BRANCHES = ['bypass', 'sumber', 'samadikun', 'csb', 'tegal'];

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal',
};

interface TransferDraft {
  destination: string;
  cart: Record<string, number>;
}

const EMPTY_DRAFT: TransferDraft = { destination: '', cart: {} };

function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

export default function NewTransferPage() {
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [warehouseStock, setWarehouseStock] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerProductId, setPickerProductId] = useState('');
  const [result, setResult] = useState<{ transferNumber: string; destination: string; totalUnits: number } | null>(null);

  const [draft, setDraft, clearDraft] = useDraftPersistence<TransferDraft>('stockist-transfer-draft', EMPTY_DRAFT);
  const { destination, cart } = draft;

  useEffect(() => {
    Promise.all([listProducts(), getInventorySummary('warehouse')])
      .then(([{ products }, { balances }]) => {
        setProducts(products.filter((p) => p.is_active));
        setWarehouseStock(Object.fromEntries(balances.map((b) => [b.product_id, b.quantity])));
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Gagal memuat produk'))
      .finally(() => setLoading(false));
  }, []);

  const cartEntries = Object.entries(cart).filter(([, qty]) => qty > 0);
  const totalUnits = cartEntries.reduce((sum, [, qty]) => sum + qty, 0);
  const totalValue = cartEntries.reduce((sum, [productId, qty]) => {
    const price = products.find((p) => p.id === productId)?.purchase_price;
    return sum + qty * (price ?? 0);
  }, 0);
  const hasProductWithoutPrice = cartEntries.some(([productId]) => {
    const price = products.find((p) => p.id === productId)?.purchase_price;
    return price == null;
  });

  function setDestination(next: string) {
    setDraft({ ...draft, destination: next });
  }

  function setCartQty(productId: string, qty: number) {
    setDraft({ ...draft, cart: { ...draft.cart, [productId]: qty } });
  }

  function addToCart(productId: string) {
    if (!productId || draft.cart[productId] !== undefined) return;
    setDraft({ ...draft, cart: { ...draft.cart, [productId]: 1 } });
    setPickerProductId('');
  }

  function removeFromCart(productId: string) {
    const next = { ...draft.cart };
    delete next[productId];
    setDraft({ ...draft, cart: next });
  }

  function saveDraft() {
    showToast('Draft tersimpan');
  }

  async function handleSubmit() {
    setSubmitError(null);
    if (!destination) {
      setSubmitError('Pilih cabang tujuan terlebih dahulu');
      return;
    }
    if (cartEntries.length === 0) {
      setSubmitError('Pilih setidaknya satu produk dan jumlahnya');
      return;
    }
    setSubmitting(true);
    try {
      const { transfer } = await createTransfer({
        destination_branch: destination,
        items: cartEntries.map(([product_id, quantity]) => ({ product_id, quantity })),
      });
      setResult({ transferNumber: transfer.transfer_number, destination: BRANCH_NAMES[destination] || destination, totalUnits });
      clearDraft();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal membuat transfer');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <SuccessScreen
        title="Transfer terkirim"
        body="Barang sedang dalam perjalanan ke cabang tujuan."
        summary={[
          { label: 'Nomor', value: result.transferNumber },
          { label: 'Tujuan', value: result.destination },
          { label: 'Total unit', value: String(result.totalUnits) },
          { label: 'Status', value: 'Dikirim' },
        ]}
        secondaryAction={{ label: 'Lihat di Ledger', href: '/admin/stockist/ledger' }}
      />
    );
  }

  const destinationStepDone = Boolean(destination);
  const productsStepDone = cartEntries.length > 0;

  return (
    <div className="flex flex-col gap-5 animate-fade-in pb-12">
      <h2 className="text-[20px] font-bold text-text-primary font-display">Buat Transfer Stok</h2>

      <div className="grid grid-cols-3 gap-2">
        {(['Tujuan', 'Produk', 'Review'] as const).map((label, i) => {
          const done = i === 0 ? destinationStepDone : i === 1 ? productsStepDone : destinationStepDone && productsStepDone;
          return (
            <div key={label} className="flex flex-col gap-1.5">
              <div className={`h-1 rounded-full ${done ? 'bg-danger' : 'bg-border-base'}`} />
              <span className={`text-[10px] font-semibold ${done ? 'text-danger' : 'text-text-muted'}`}>{label}</span>
            </div>
          );
        })}
      </div>

      {loadError && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{loadError}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold text-text-secondary">Cabang tujuan</h3>
            <div className="flex flex-wrap gap-2">
              {BRANCHES.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setDestination(b)}
                  className={`h-[38px] rounded-full border px-4 text-[12px] font-bold transition-colors ${
                    destination === b ? 'border-primary-container bg-primary-container text-white' : 'border-border-base bg-surface-elevated text-text-secondary'
                  }`}
                >
                  {BRANCH_NAMES[b]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-text-secondary">Produk dikirim</h3>
              <span className="text-[11px] text-text-muted">{cartEntries.length} item · {totalUnits} pcs</span>
            </div>

            <div className="flex flex-col gap-2">
              {cartEntries.map(([productId, qty]) => {
                const product = products.find((p) => p.id === productId);
                if (!product) return null;
                const stock = warehouseStock[productId] ?? 0;
                const image = getKnownProductImage(product.name);
                return (
                  <div key={productId} className="flex items-center gap-3 rounded-xl border border-border-base bg-surface-elevated p-3">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-container-lowest">
                      {image ? (
                        <img src={image} alt={product.name} className="h-full w-full object-contain p-1" />
                      ) : (
                        <Package size={22} className="text-text-muted" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-[13px] font-bold text-text-primary">{product.name}</h4>
                      <span className="text-[10.5px] text-text-muted">Gudang: {stock} pcs</span>
                    </div>
                    <Stepper value={qty} onChange={(next) => setCartQty(productId, next)} min={0} max={stock} size="xs" />
                    <button
                      type="button"
                      onClick={() => removeFromCart(productId)}
                      className="text-text-muted hover:text-danger w-7 h-7 rounded-full flex items-center justify-center"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-dashed border-border-base p-2.5">
              <select
                value={pickerProductId}
                onChange={(e) => setPickerProductId(e.target.value)}
                className="flex-1 bg-transparent text-[12.5px] text-text-primary focus:outline-none"
              >
                <option value="">-- Pilih produk untuk ditambahkan --</option>
                {products.filter((p) => draft.cart[p.id] === undefined).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => addToCart(pickerProductId)}
                disabled={!pickerProductId}
                className="text-[12px] font-bold text-primary-container disabled:opacity-40"
              >
                Tambah Produk
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-border-base bg-surface-elevated p-4">
            <h3 className="text-[13px] font-semibold text-text-secondary">Review transfer</h3>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-text-muted">Asal</span>
              <span className="font-semibold text-text-primary">Gudang Pusat</span>
            </div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-text-muted">Tujuan</span>
              <span className="font-semibold text-text-primary">{destination ? BRANCH_NAMES[destination] : '-'}</span>
            </div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-text-muted">Total unit</span>
              <span className="font-semibold text-text-primary">{totalUnits}</span>
            </div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-text-muted">Nilai perkiraan</span>
              <span className="font-semibold text-text-primary">{formatRupiah(totalValue)}</span>
            </div>
            {hasProductWithoutPrice && (
              <p className="text-[10.5px] text-status-menipis">Beberapa produk belum punya harga beli — nilai perkiraan mungkin belum lengkap.</p>
            )}
          </div>

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
              disabled={submitting}
              className="h-[46px] rounded-xl bg-primary-container text-white text-[13px] font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">send</span>
              {submitting ? 'Mengirim...' : 'Kirim Transfer'}
            </button>
            <button
              type="button"
              onClick={saveDraft}
              className="h-[44px] rounded-xl border border-border-base text-text-primary text-[13px] font-bold active:scale-95 transition-transform"
            >
              Simpan Draft
            </button>
          </div>
        </>
      )}
    </div>
  );
}
