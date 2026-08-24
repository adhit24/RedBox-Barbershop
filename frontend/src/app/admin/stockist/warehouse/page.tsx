'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { listProducts, getInventorySummary, receiveWarehouseStock, type StockistProduct, type InventoryBalance } from '@/lib/stockistApi';
import { BarcodeScannerSheet } from '@/components/stockist/BarcodeScannerSheet';
import { EmptyState } from '@/components/stockist/EmptyState';

type StockStatus = 'AMAN' | 'MENIPIS' | 'HABIS';

function stockStatusFor(qty: number, minimumStock: number): StockStatus {
  if (qty === 0) return 'HABIS';
  if (qty <= minimumStock) return 'MENIPIS';
  return 'AMAN';
}

const STATUS_DOT: Record<StockStatus, string> = { AMAN: 'bg-success', MENIPIS: 'bg-status-menipis', HABIS: 'bg-danger' };
const STATUS_BADGE: Record<StockStatus, string> = { AMAN: 'bg-tint-success text-success', MENIPIS: 'bg-tint-warning text-status-menipis', HABIS: 'bg-tint-danger text-danger' };
const STATUS_TEXT: Record<StockStatus, string> = { AMAN: 'text-text-primary', MENIPIS: 'text-status-menipis', HABIS: 'text-danger' };
const STATUS_LABEL: Record<StockStatus, string> = { AMAN: 'Aman', MENIPIS: 'Menipis', HABIS: 'Habis' };

function WarehousePageContent() {
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
  const searchParams = useSearchParams();
  const initialFilter = searchParams?.get('filter');
  const [filterType, setFilterType] = useState<'ALL' | 'AMAN' | 'MENIPIS' | 'HABIS'>(
    initialFilter === 'AMAN' || initialFilter === 'MENIPIS' || initialFilter === 'HABIS' ? initialFilter : 'ALL'
  );
  const [scannerOpen, setScannerOpen] = useState(false);

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

  function handleScan(code: string) {
    setScannerOpen(false);
    const match = products.find((p) => p.barcode && p.barcode === code);
    if (match) {
      setSearchQuery(match.sku);
    } else {
      setError('Produk dengan barcode ini tidak ditemukan.');
    }
  }

  const quantityByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));

  // Stats calculation
  const totalSKUs = products.length;
  const totalQty = balances.reduce((sum, b) => sum + b.quantity, 0);

  const productStats = products.map(p => {
    const qty = quantityByProduct.get(p.id) ?? 0;
    const status = stockStatusFor(qty, p.minimum_stock);
    return { ...p, qty, status };
  });

  const lowStockCount = productStats.filter(p => p.status === 'MENIPIS').length;

  // Filter products for listing
  const filteredProducts = productStats.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterType === 'ALL' || p.status === filterType;
    return matchesSearch && matchesFilter;
  });

  const getProductImage = (sku: string, name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('clay') || lowerName.includes('pomade')) return '/api/stockist/product-image/clay.jpeg';
    if (lowerName.includes('oil')) return '/api/stockist/product-image/oil_base.jpeg';
    if (lowerName.includes('water') || lowerName.includes('spray')) return '/api/stockist/product-image/water_base.jpeg';
    if (lowerName.includes('shave') || lowerName.includes('cream') || lowerName.includes('psyi')) return '/api/stockist/product-image/psyi.jpeg';
    return '/api/stockist/product-image/E_left_here.jpeg';
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
            className="flex items-center gap-1.5 px-3 py-2 bg-primary-container text-white text-[12px] font-semibold rounded-lg hover:bg-inverse-primary transition-all active:scale-95"
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
            onClick={() => setFilterType(filterType === 'MENIPIS' ? 'ALL' : 'MENIPIS')}
            className={`bg-surface-elevated border rounded-xl p-4 flex flex-col justify-between min-h-[96px] relative overflow-hidden cursor-pointer active:scale-98 transition-all ${
              filterType === 'MENIPIS' ? 'border-status-menipis' : 'border-border-base'
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
                className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2.5 text-text-primary focus:outline-none focus:border-primary-container"
                required
              >
                <option value="">-- Pilih produk --</option>
                {products.filter((p) => p.is_active).map((p) => (
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
                  className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-text-secondary">No. Invoice / Catatan</label>
                <input
                  placeholder="No. Invoice / Supplier"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-primary-container hover:bg-inverse-primary text-white font-bold text-sm h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow mt-2"
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
            className="w-full bg-surface-container-lowest border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-10 py-2 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted transition-colors"
          />
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            aria-label="Scan barcode produk"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-primary-container hover:bg-primary-container/10"
          >
            <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
          </button>
        </div>
        <div className="sc flex gap-2 overflow-x-auto pb-1">
          {(['ALL', 'AMAN', 'MENIPIS', 'HABIS'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilterType(value)}
              className={`flex-none rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
                filterType === value ? 'border-primary-container bg-primary-container text-white' : 'border-border-base bg-surface-elevated text-text-secondary'
              }`}
            >
              {value === 'ALL' ? 'Semua' : value === 'AMAN' ? 'Aman' : value === 'MENIPIS' ? 'Menipis' : 'Habis'}
            </button>
          ))}
        </div>
      </section>
      <BarcodeScannerSheet open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />

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
            <EmptyState
              icon="inventory_2"
              title="Tidak ada produk"
              subtitle="Coba ubah kata kunci pencarian atau filter status."
              action={{ label: 'Reset filter', onClick: () => { setSearchQuery(''); setFilterType('ALL'); } }}
            />
          ) : (
            filteredProducts.map((p) => (
              <Link
                key={p.id}
                href={`/admin/stockist/branch-stock/all/${p.id}?branch=warehouse`}
                className="flex items-center gap-3 rounded-xl border border-border-base bg-surface-elevated p-3 hover:border-primary-container/40 active:scale-[0.98] transition-all"
              >
                <div className="relative h-[66px] w-[66px] shrink-0 overflow-hidden rounded-xl border border-border-base bg-surface-container-lowest">
                  <img
                    className="h-full w-full object-cover opacity-85 mix-blend-luminosity"
                    src={getProductImage(p.sku, p.name)}
                    alt={p.name}
                  />
                  <span className={`absolute bottom-0 left-0 h-3 w-3 rounded-full border-[2.5px] border-surface-elevated ${STATUS_DOT[p.status]}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-[13.5px] font-bold text-text-primary">{p.name}</h4>
                  <span className="block text-[10px] font-mono text-text-muted">{p.sku}</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    {p.category && (
                      <span className="rounded border border-border-base bg-surface-container px-1.5 py-0.5 text-[9px] font-semibold text-text-secondary">{p.category}</span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${STATUS_BADGE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={`text-[19px] font-bold font-display tabular-nums ${STATUS_TEXT[p.status]}`}>{p.qty}</span>
                  <span className="text-[9px] text-text-muted">{p.unit}</span>
                </div>
                <span className="material-symbols-outlined shrink-0 text-[18px] text-text-muted">chevron_right</span>
              </Link>
            ))
          )}
        </section>
      )}
    </div>
  );
}

export default function WarehousePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <WarehousePageContent />
    </Suspense>
  );
}
