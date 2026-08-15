'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listProducts, createTransfer, type StockistProduct } from '@/lib/stockistApi';

const BRANCHES = ['bypass', 'sumber', 'samadikun', 'csb', 'tegal'];

export default function NewTransferPage() {
  const router = useRouter();
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [destination, setDestination] = useState('');
  const [lines, setLines] = useState<{ product_id: string; quantity: string }[]>([
    { product_id: '', quantity: '' }
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    listProducts()
      .then(({ products }) => {
        setProducts(products);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Gagal memuat produk');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  function addLine() {
    setLines([...lines, { product_id: '', quantity: '' }]);
  }

  function removeLine(i: number) {
    if (lines.length > 1) {
      setLines(lines.filter((_, idx) => idx !== i));
    } else {
      setLines([{ product_id: '', quantity: '' }]);
    }
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

      if (validItems.length === 0) {
        throw new Error('Pilih setidaknya satu produk dan jumlahnya');
      }

      const { transfer } = await createTransfer({
        destination_branch: destination,
        items: validItems,
      });
      router.push(`/admin/stockist/transfers/${transfer.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat transfer');
    } finally {
      setSubmitting(false);
    }
  }

  const getProductImage = (sku: string, name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('clay') || lowerName.includes('pomade')) return '/uploads/clay.jpeg';
    if (lowerName.includes('oil')) return '/uploads/oil_base.jpeg';
    if (lowerName.includes('water') || lowerName.includes('spray')) return '/uploads/water_base.jpeg';
    if (lowerName.includes('shave') || lowerName.includes('cream') || lowerName.includes('psyi')) return '/uploads/psyi.jpeg';
    return '/uploads/E_left_here.jpeg';
  };

  return (
    <div className="flex flex-col gap-5 animate-fade-in pb-12">
      {/* Header Context */}
      <div className="flex items-center gap-2">
        <button 
          onClick={() => router.back()}
          className="w-10 h-10 flex items-center justify-center text-text-primary hover:bg-surface-elevated active:scale-95 transition-transform rounded-full -ml-2"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div>
          <h2 className="text-[20px] font-bold text-text-primary font-display">Buat Transfer Stok</h2>
          <p className="text-[12px] text-text-muted">Pindahkan stok dari gudang utama ke cabang.</p>
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
          {/* Route Section */}
          <section className="bg-surface-elevated rounded-xl p-4 border border-border-base flex flex-col gap-3 shadow-sm">
            {/* Source */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Lokasi Asal</label>
              <div className="flex items-center gap-3 p-2 bg-[#171415] rounded-lg border border-border-base">
                <div className="w-8 h-8 rounded bg-surface-container flex items-center justify-center text-text-muted border border-border-base">
                  <span className="material-symbols-outlined text-[16px]">warehouse</span>
                </div>
                <div className="flex flex-col justify-center">
                  <span className="text-[13px] font-semibold text-text-primary">Gudang Utama (Pusat)</span>
                </div>
              </div>
            </div>

            {/* Destination Connector Visual */}
            <div className="pl-6 -my-2 flex items-center">
              <div className="w-[1.5px] h-4 bg-border-base"></div>
            </div>

            {/* Destination */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Cabang Tujuan *</label>
              <div className="relative">
                <select 
                  value={destination} 
                  onChange={(e) => setDestination(e.target.value)} 
                  className="w-full bg-[#171415] border border-border-base rounded-lg p-2.5 text-text-primary text-sm focus:outline-none focus:border-primary-container"
                  required
                >
                  <option value="">Pilih cabang tujuan...</option>
                  {BRANCHES.map((b) => (
                    <option key={b} value={b} className="capitalize">
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Product Items Details Section */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Detail Produk</h3>
              <span className="text-[11px] text-text-muted">
                {lines.filter(l => l.product_id).length} Item Dipilih
              </span>
            </div>

            {/* Selected Products List */}
            <div className="flex flex-col gap-2">
              {lines.map((line, i) => {
                const selectedProd = products.find(p => p.id === line.product_id);
                return (
                  <div key={i} className="bg-surface-elevated rounded-xl p-3 border border-border-base flex items-center gap-3 relative animate-fade-in">
                    
                    {/* Select Product Input */}
                    <div className="flex-1 flex flex-col gap-2">
                      <select
                        value={line.product_id}
                        onChange={(e) => updateLine(i, { product_id: e.target.value })}
                        className="w-full bg-[#171415] border border-border-base rounded-lg px-2.5 py-2 text-text-primary text-[13px] focus:outline-none focus:border-primary-container"
                      >
                        <option value="">-- Pilih produk --</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                          </option>
                        ))}
                      </select>

                      {/* Line Details (when product is selected) */}
                      {selectedProd && (
                        <div className="flex items-center gap-2 pl-1.5 text-[10px] text-text-muted font-mono">
                          <span>SKU: {selectedProd.sku}</span>
                          <span>•</span>
                          <span>Limit: {selectedProd.minimum_stock} {selectedProd.unit}</span>
                        </div>
                      )}
                    </div>

                    {/* Quantity Input */}
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

                    {/* Delete Line Button */}
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

            {/* Add Line button */}
            <button
              type="button"
              onClick={addLine}
              className="text-xs text-primary-container hover:text-inverse-primary font-bold self-start pl-1 flex items-center gap-1 mt-1 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[16px]">add_circle</span>
              Tambah Produk Baru
            </button>
          </section>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-primary-container hover:bg-inverse-primary text-text-primary font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg border border-[#302728] mt-3"
          >
            <span className="material-symbols-outlined text-[18px]">send</span>
            {submitting ? 'Membuat Transfer...' : 'Kirim Transfer Stok'}
          </button>
        </form>
      )}
    </div>
  );
}
