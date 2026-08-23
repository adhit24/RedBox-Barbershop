'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { listProducts, getInventorySummary, createStockReturn, type StockistProduct, type InventoryBalance, type ReturnCategory } from '@/lib/stockistApi';

const CATEGORIES: { value: ReturnCategory; label: string }[] = [
  { value: 'RUSAK', label: 'Barang Rusak' },
  { value: 'KEDALUWARSA', label: 'Kedaluwarsa' },
  { value: 'SALAH_KIRIM', label: 'Salah Kirim' },
  { value: 'KELEBIHAN', label: 'Kelebihan Stok' },
  { value: 'LAINNYA', label: 'Lainnya' },
];

export default function NewStockReturnPage() {
  const router = useRouter();
  const { user } = useUser();
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [category, setCategory] = useState<ReturnCategory>('RUSAK');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<{ product_id: string; quantity: string }[]>([
    { product_id: '', quantity: '' }
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user?.branch) return;
    setLoading(true);
    Promise.all([listProducts(), getInventorySummary(user.branch)])
      .then(([{ products }, { balances }]) => {
        setProducts(products);
        setBalances(balances);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat produk'))
      .finally(() => setLoading(false));
  }, [user?.branch]);

  const quantityByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));

  function addLine() {
    setLines([...lines, { product_id: '', quantity: '' }]);
  }

  function removeLine(i: number) {
    if (lines.length > 1) setLines(lines.filter((_, idx) => idx !== i));
    else setLines([{ product_id: '', quantity: '' }]);
  }

  function updateLine(i: number, patch: Partial<{ product_id: string; quantity: string }>) {
    setLines((prev) => prev.map((line, idx) => (idx === i ? { ...line, ...patch } : line)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const validItems = lines
        .filter((l) => l.product_id && l.quantity)
        .map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) }));
      if (validItems.length === 0) throw new Error('Pilih setidaknya satu produk dan jumlahnya');

      const { return: stockReturn } = await createStockReturn({ category, reason: reason.trim() || undefined, items: validItems });
      router.push(`/admin/stockist/returns/${stockReturn.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengajukan retur');
    } finally {
      setSubmitting(false);
    }
  }

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
          <h2 className="text-[20px] font-bold text-text-primary font-display">Ajukan Retur Barang</h2>
          <p className="text-[12px] text-text-muted">Kirim barang bermasalah kembali ke Gudang Pusat.</p>
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <section className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Kategori Retur *</label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={`h-[42px] rounded-lg text-[12px] font-semibold border transition-all ${
                    category === c.value
                      ? 'bg-primary-container border-primary-container text-white'
                      : 'bg-surface-elevated border-border-base text-text-secondary hover:border-text-muted'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Detail Produk</h3>
              <span className="text-[11px] text-text-muted">{lines.filter(l => l.product_id).length} Item Dipilih</span>
            </div>

            <div className="flex flex-col gap-2">
              {lines.map((line, i) => {
                const selectedProd = products.find(p => p.id === line.product_id);
                const currentQty = selectedProd ? (quantityByProduct.get(selectedProd.id) ?? 0) : null;
                return (
                  <div key={i} className="bg-surface-elevated rounded-xl p-3 border border-border-base flex items-center gap-3 relative animate-fade-in">
                    <div className="flex-1 flex flex-col gap-2">
                      <select
                        value={line.product_id}
                        onChange={(e) => updateLine(i, { product_id: e.target.value })}
                        className="w-full bg-[#171415] border border-border-base rounded-lg px-2.5 py-2 text-text-primary text-[13px] focus:outline-none focus:border-primary-container"
                      >
                        <option value="">-- Pilih produk --</option>
                        {products.filter((p) => p.is_active).map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                        ))}
                      </select>
                      {selectedProd && (
                        <div className="flex items-center gap-2 pl-1.5 text-[10px] text-text-muted font-mono">
                          <span>Stok saya saat ini: {currentQty} {selectedProd.unit}</span>
                        </div>
                      )}
                    </div>
                    <div className="w-20 shrink-0">
                      <input
                        type="number"
                        min={1}
                        placeholder="Qty"
                        value={line.quantity}
                        onChange={(e) => updateLine(i, { quantity: e.target.value })}
                        className="w-full bg-[#171415] border border-border-base rounded-lg px-2.5 py-2 text-text-primary text-[13px] focus:outline-none focus:border-primary-container text-center font-bold font-display"
                        required
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="text-text-muted hover:text-danger w-8 h-8 rounded-full flex items-center justify-center hover:bg-danger/10 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={addLine}
              className="text-xs text-primary-container hover:text-inverse-primary font-bold self-start pl-1 flex items-center gap-1 mt-1 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[16px]">add_circle</span>
              Tambah Produk Baru
            </button>
          </section>

          <section className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Catatan (opsional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Mis: kemasan penyok saat pengiriman"
              rows={3}
              className="w-full bg-[#171415] border border-border-base rounded-lg p-3 text-text-primary text-sm focus:outline-none focus:border-primary-container resize-none"
            />
          </section>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-primary-container hover:bg-inverse-primary text-white font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg mt-3"
          >
            <span className="material-symbols-outlined text-[18px]">send</span>
            {submitting ? 'Mengajukan...' : 'Ajukan Retur'}
          </button>
        </form>
      )}
    </div>
  );
}
