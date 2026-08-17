'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { listProducts, getInventorySummary, receiveWarehouseStock, type StockistProduct, type InventoryBalance } from '@/lib/stockistApi';

export default function WarehousePage() {
  const { user } = useUser();
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ product_id: '', quantity: '', reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'LOW' | 'SAFE'>('ALL');

  async function refresh() {
    setLoading(true);
    try {
      const [{ products }, { balances }] = await Promise.all([
        listProducts(),
        getInventorySummary('warehouse') // central warehouse location is 'warehouse'
      ]);
      setProducts(products);
      setBalances(balances);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat inventori gudang');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleReceive(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await receiveWarehouseStock({
        product_id: form.product_id,
        quantity: Number(form.quantity),
        reason: form.reason || undefined
      });
      setForm({ product_id: '', quantity: '', reason: '' });
      setShowForm(false);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menerima barang');
    } finally {
      setSubmitting(false);
    }
  }

  const quantityByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));

  // Stats calculation
  const totalSKUs = products.length;
  const totalQty = balances.reduce((sum, b) => sum + b.quantity, 0);
  
  const productStats = products.map(p => {
    const qty = quantityByProduct.get(p.id) ?? 0;
    const isLow = qty <= p.minimum_stock;
    return { ...p, qty, isLow };
  });

  const lowStockCount = productStats.filter(p => p.isLow).length;

  // Filter products for listing
  const filteredProducts = productStats.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterType === 'ALL' || 
                          (filterType === 'LOW' && p.isLow) || 
                          (filterType === 'SAFE' && !p.isLow);
    return matchesSearch && matchesFilter;
  });

  const getProductImage = (sku: string, name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('clay') || lowerName.includes('pomade')) return '/uploads/clay.jpeg';
    if (lowerName.includes('oil')) return '/uploads/oil_base.jpeg';
    if (lowerName.includes('water') || lowerName.includes('spray')) return '/uploads/water_base.jpeg';
    if (lowerName.includes('shave') || lowerName.includes('cream') || lowerName.includes('psyi')) return '/uploads/psyi.jpeg';
    return '/uploads/E_left_here.jpeg';
  };

  const isOwner = user?.role === 'owner';

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Header Context */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Gudang Pusat</h2>
          <p className="text-[12px] text-text-muted mt-1">Status dan penerimaan barang gudang.</p>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary-container text-text-primary text-[12px] font-semibold rounded-lg hover:bg-inverse-primary transition-all active:scale-95 border border-[#302728]"
          >
            <span className="material-symbols-outlined text-[16px]">{showForm ? 'close' : 'call_received'}</span>
            {showForm ? 'Batal' : 'Terima'}
          </button>
        )}
      </div>

      {/* Bento Metric Grid */}
      {!loading && !error && (
        <section className="grid grid-cols-2 gap-3">
          {/* Total SKU */}
          <div className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col justify-between min-h-[96px]">
            <span className="material-symbols-outlined text-text-muted text-[18px]">inventory_2</span>
            <div>
              <p className="text-[24px] font-bold text-text-primary tabular-nums font-display leading-none mt-2">
                {totalSKUs}
              </p>
              <p className="text-[10px] text-text-secondary font-medium mt-1">Total Produk (SKU)</p>
            </div>
          </div>

          {/* Total Quantity */}
          <div className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col justify-between min-h-[96px]">
            <span className="material-symbols-outlined text-text-muted text-[18px]">layers</span>
            <div>
              <p className="text-[24px] font-bold text-text-primary tabular-nums font-display leading-none mt-2">
                {totalQty.toLocaleString('id-ID')}
              </p>
              <p className="text-[10px] text-text-secondary font-medium mt-1">Total Pcs Fisik</p>
            </div>
          </div>

          {/* Low Stock Items */}
          <div 
            onClick={() => setFilterType(filterType === 'LOW' ? 'ALL' : 'LOW')}
            className={`bg-surface-elevated border rounded-xl p-4 flex flex-col justify-between min-h-[96px] relative overflow-hidden cursor-pointer active:scale-98 transition-all ${
              filterType === 'LOW' ? 'border-status-menipis' : 'border-border-base'
            }`}
          >
            <div className="absolute -top-4 -right-4 w-12 h-12 bg-status-menipis opacity-10 blur-xl rounded-full"></div>
            <span className="material-symbols-outlined text-status-menipis text-[18px] z-10" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
            <div className="z-10">
              <p className="text-[24px] font-bold text-status-menipis tabular-nums font-display leading-none mt-2">
                {lowStockCount}
              </p>
              <p className="text-[10px] text-text-secondary font-medium mt-1">Stok Menipis</p>
            </div>
          </div>

          {/* Filter Reset / Overview */}
          <div 
            onClick={() => setFilterType('ALL')}
            className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col justify-between min-h-[96px] cursor-pointer active:scale-98 transition-all hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-success text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            <div>
              <p className="text-[18px] font-bold text-text-primary font-display leading-tight mt-2">
                {filterType === 'ALL' ? 'Semua Stok' : 'Reset Filter'}
              </p>
              <p className="text-[10px] text-text-secondary font-medium mt-1">Tampilkan Semua</p>
            </div>
          </div>
        </section>
      )}

      {/* Receive Stock Form (Collapsible) */}
      {isOwner && showForm && (
        <form onSubmit={handleReceive} className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-4 shadow-lg animate-slide-up">
          <h3 className="font-semibold text-[14px] text-text-primary flex items-center gap-1.5 border-b border-border-base pb-2">
            <span className="material-symbols-outlined text-[18px]">call_received</span>
            Terima Barang Masuk
          </h3>

          {formError && (
            <div className="bg-danger/10 border border-danger text-danger text-[12px] rounded-lg p-2.5 flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">error</span>
              <span>{formError}</span>
            </div>
          )}

          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-text-secondary">Pilih Produk *</label>
              <select
                value={form.product_id}
                onChange={(e) => setForm({ ...form, product_id: e.target.value })}
                className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2.5 text-text-primary focus:outline-none focus:border-primary-container"
                required
              >
                <option value="">-- Pilih produk --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-text-secondary">Quantity Diterima *</label>
                <input
                  type="number"
                  min={1}
                  placeholder="Mis: 100"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-text-secondary">No. Invoice / Catatan</label>
                <input
                  placeholder="No. Invoice / Supplier"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-primary-container hover:bg-inverse-primary text-text-primary font-bold text-sm h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow border border-[#302728] mt-2"
            >
              {submitting ? 'Memproses...' : 'Konfirmasi Terima Barang'}
            </button>
          </div>
        </form>
      )}

      {/* Search Bar */}
      <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 shadow-sm">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Cari nama atau SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#171415] border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted transition-colors"
          />
        </div>
      </section>

      {/* Inventory Status List */}
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
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Status Inventory</h3>
            <span className="text-[11px] text-text-muted">
              Menampilkan {filteredProducts.length} item
            </span>
          </div>

          {filteredProducts.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8 bg-surface-elevated border border-border-base rounded-xl">
              Tidak ada produk di inventori.
            </p>
          ) : (
            filteredProducts.map((p) => (
              <div 
                key={p.id} 
                className="bg-surface-elevated border border-border-base rounded-xl p-4 flex items-center gap-3 hover:bg-surface-container transition-colors"
              >
                {/* Thumbnail */}
                <div className="w-12 h-12 rounded-lg bg-[#171415] border border-border-base overflow-hidden flex-shrink-0 flex items-center justify-center">
                  <img 
                    className="w-full h-full object-cover opacity-85 mix-blend-luminosity" 
                    src={getProductImage(p.sku, p.name)} 
                    alt={p.name} 
                  />
                </div>

                {/* Core Info */}
                <div className="flex-1 flex flex-col justify-center min-h-[48px]">
                  <h4 className="font-semibold text-text-primary text-[14px] leading-tight">{p.name}</h4>
                  <span className="text-[10px] text-text-muted mt-1 font-mono">SKU: {p.sku}</span>
                </div>

                {/* Balance & Status */}
                <div className="flex flex-col items-end justify-center min-h-[48px]">
                  <p className="text-[18px] font-bold text-text-primary font-display tabular-nums leading-tight">
                    {p.qty}
                  </p>
                  <span className={`text-[10px] font-semibold mt-1 flex items-center gap-1.5 ${
                    p.isLow ? 'text-status-menipis' : 'text-status-aman'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      p.isLow ? 'bg-status-menipis animate-pulse' : 'bg-status-aman'
                    }`}></span>
                    {p.isLow ? 'Menipis' : 'Aman'}
                  </span>
                </div>
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}
