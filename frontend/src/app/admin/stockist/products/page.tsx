'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { listProducts, createProduct, updateProduct, deactivateProduct, activateProduct, getInventorySummary, type StockistProduct, type InventoryBalance } from '@/lib/stockistApi';
import { BackButton } from '@/components/stockist/BackButton';
import { BarcodeScannerSheet } from '@/components/stockist/BarcodeScannerSheet';
import { EmptyState } from '@/components/stockist/EmptyState';
import { getKnownProductImage } from '@/lib/stockist/productImage';

type EditForm = {
  sku: string; name: string; unit: string; category: string; brand: string;
  purchase_price: string; retail_price: string; minimum_stock: string;
  product_type: NonNullable<StockistProduct['product_type']>;
};

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

export default function ProductsPage() {
  const { user } = useUser();
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Semua');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'AMAN' | 'MENIPIS' | 'HABIS'>('ALL');
  const [scannerOpen, setScannerOpen] = useState(false);

  // Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    sku: '',
    name: '',
    unit: 'pcs',
    category: '',
    brand: '',
    purchase_price: '',
    retail_price: '',
    minimum_stock: '5',
    product_type: 'RETAIL' as NonNullable<StockistProduct['product_type']>
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Edit / deactivate state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  function startEdit(p: StockistProduct) {
    setEditingId(p.id);
    setEditError(null);
    setEditForm({
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      category: p.category || '',
      brand: p.brand || '',
      purchase_price: p.purchase_price != null ? String(p.purchase_price) : '',
      retail_price: p.retail_price != null ? String(p.retail_price) : '',
      minimum_stock: String(p.minimum_stock),
      product_type: p.product_type || 'RETAIL',
    });
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId || !editForm) return;
    setEditError(null);
    setEditSubmitting(true);
    try {
      await updateProduct(editingId, {
        sku: editForm.sku,
        name: editForm.name,
        unit: editForm.unit,
        category: editForm.category || null,
        brand: editForm.brand || null,
        purchase_price: editForm.purchase_price ? Number(editForm.purchase_price) : null,
        retail_price: editForm.retail_price ? Number(editForm.retail_price) : null,
        minimum_stock: Number(editForm.minimum_stock),
        product_type: editForm.product_type,
      });
      setEditingId(null);
      setEditForm(null);
      await refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Gagal menyimpan perubahan');
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleToggleActive(p: StockistProduct) {
    const confirmMsg = p.is_active
      ? `Nonaktifkan "${p.name}"? Produk tidak dapat dipakai di transaksi baru, tapi riwayat stok tetap tersimpan.`
      : `Aktifkan kembali "${p.name}"?`;
    if (!confirm(confirmMsg)) return;
    setTogglingId(p.id);
    try {
      if (p.is_active) await deactivateProduct(p.id);
      else await activateProduct(p.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status produk');
    } finally {
      setTogglingId(null);
    }
  }

  async function refresh() {
    setLoading(true);
    try {
      const [{ products }, { balances }] = await Promise.all([
        listProducts(),
        getInventorySummary(user?.branch || ''),
      ]);
      setProducts(products);
      setBalances(balances);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat produk');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.branch) return;
    refresh();
  }, [user?.branch]);

  function handleScan(code: string) {
    setScannerOpen(false);
    const match = products.find((p) => p.barcode && p.barcode === code);
    if (match) {
      setSearchQuery(match.sku);
    } else {
      setError('Produk dengan barcode ini tidak ditemukan.');
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await createProduct({
        sku: form.sku,
        name: form.name,
        unit: form.unit,
        category: form.category || null,
        brand: form.brand || null,
        purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
        retail_price: form.retail_price ? Number(form.retail_price) : null,
        minimum_stock: Number(form.minimum_stock),
        product_type: form.product_type,
      });
      // Reset form
      setForm({
        sku: '',
        name: '',
        unit: 'pcs',
        category: '',
        brand: '',
        purchase_price: '',
        retail_price: '',
        minimum_stock: '5',
        product_type: 'RETAIL'
      });
      setShowAddForm(false);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal membuat produk');
    } finally {
      setSubmitting(false);
    }
  }

  const isOwner = user?.role === 'owner';

  if (isOwner) return <OwnerInventoryView />;

  // Categories list extracted from products
  const categories = ['Semua', ...Array.from(new Set(products.map(p => p.category).filter((c): c is string => !!c)))];

  const qtyByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));

  // Filter products
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'Semua' || p.category === selectedCategory;
    const matchesStatus = statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? p.is_active : !p.is_active);
    const qty = qtyByProduct.get(p.id) ?? 0;
    const stockStatus = stockStatusFor(qty, p.minimum_stock);
    const matchesStock = stockFilter === 'ALL' || stockStatus === stockFilter;
    return matchesSearch && matchesCategory && matchesStatus && matchesStock;
  });

  const getProductImage = (sku: string, name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('clay') || lowerName.includes('pomade')) return '/api/stockist/product-image/clay.jpeg';
    if (lowerName.includes('oil')) return '/api/stockist/product-image/oil_base.jpeg';
    if (lowerName.includes('water') || lowerName.includes('spray')) return '/api/stockist/product-image/water_base.jpeg';
    if (lowerName.includes('shave') || lowerName.includes('cream') || lowerName.includes('psyi')) return '/api/stockist/product-image/psyi.jpeg';
    return '/api/stockist/product-image/E_left_here.jpeg';
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val);
  };

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Header Area */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Katalog Produk</h2>
          <p className="text-[12px] text-text-muted mt-1">Kelola katalog produk dan harga.</p>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary-container text-white text-[12px] font-semibold rounded-lg hover:bg-inverse-primary transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-[16px]">{showAddForm ? 'close' : 'add'}</span>
            {showAddForm ? 'Batal' : 'Produk'}
          </button>
        )}
      </div>

      {/* Add Product Form (Collapsible) */}
      {isOwner && showAddForm && (
        <form onSubmit={handleCreate} className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-4 shadow-lg animate-slide-up">
          <h3 className="font-semibold text-[14px] text-text-primary flex items-center gap-1.5 border-b border-border-base pb-2">
            <span className="material-symbols-outlined text-[18px]">add_box</span>
            Tambah Produk Baru
          </h3>
          
          {formError && (
            <div className="bg-danger/10 border border-danger text-danger text-[12px] rounded-lg p-2.5 flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">error</span>
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[11px] font-medium text-text-secondary">SKU Produk *</label>
              <input
                placeholder="Mis: RBX-CLY-001"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[11px] font-medium text-text-secondary">Nama Produk *</label>
              <input
                placeholder="Mis: RedBox Matte Clay Premium"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-text-secondary">Kategori</label>
              <input
                placeholder="Pomade, Equipment, etc."
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-text-secondary">Satuan Unit</label>
              <input
                placeholder="pcs, botol, pack"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[11px] font-medium text-text-secondary">Jenis Penggunaan</label>
              <select value={form.product_type} onChange={(e) => setForm({ ...form, product_type: e.target.value as NonNullable<StockistProduct['product_type']> })} className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary">
                <option value="RETAIL">Retail</option>
                <option value="SERVICE_CONSUMABLE">Barang Pemakaian</option>
                <option value="BOTH">Retail + Barang Pemakaian</option>
                <option value="CONSUMABLE">Perlengkapan</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-text-secondary">Harga Beli</label>
              <input
                type="number"
                placeholder="Harga Modal"
                value={form.purchase_price}
                onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
                className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-text-secondary">Harga Jual *</label>
              <input
                type="number"
                placeholder="Harga Retail"
                value={form.retail_price}
                onChange={(e) => setForm({ ...form, retail_price: e.target.value })}
                className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-text-secondary">Minimum Stock</label>
              <input
                type="number"
                placeholder="Batas warning limit"
                value={form.minimum_stock}
                onChange={(e) => setForm({ ...form, minimum_stock: e.target.value })}
                className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors"
                required
              />
            </div>
            
            <div className="flex items-end col-span-1 pt-1.5">
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary-container hover:bg-inverse-primary text-white font-bold text-xs h-[38px] rounded-lg flex items-center justify-center gap-1 active:scale-95 transition-all shadow"
              >
                {submitting ? 'Menyimpan...' : 'Simpan Produk'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Search & Filter bar */}
      <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 shadow-sm">
        {/* Search Input */}
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

        {/* Status Chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {([['ACTIVE', 'Aktif'], ['INACTIVE', 'Nonaktif'], ['ALL', 'Semua Status']] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={`whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                statusFilter === value
                  ? 'bg-primary-container border-primary-container text-white'
                  : 'bg-surface-container-low border-border-base text-text-secondary hover:border-text-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Stock Status Chips */}
        <div className="sc flex gap-2 overflow-x-auto pb-1">
          {(['ALL', 'AMAN', 'MENIPIS', 'HABIS'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStockFilter(value)}
              className={`flex-none rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
                stockFilter === value ? 'border-primary-container bg-primary-container text-white' : 'border-border-base bg-surface-elevated text-text-secondary'
              }`}
            >
              {value === 'ALL' ? 'Semua' : value === 'AMAN' ? 'Aman' : value === 'MENIPIS' ? 'Menipis' : 'Habis'}
            </button>
          ))}
        </div>

        {/* Categories Chips */}
        {categories.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                  selectedCategory === cat
                    ? 'bg-primary-container border-primary-container text-white'
                    : 'bg-surface-container-low border-border-base text-text-secondary hover:border-text-muted'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </section>
      <BarcodeScannerSheet open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />

      {/* Products Listing */}
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
          {filteredProducts.length === 0 ? (
            <EmptyState
              icon="inventory_2"
              title="Tidak ada produk"
              subtitle="Coba ubah kata kunci pencarian atau filter status."
              action={{
                label: 'Reset filter',
                onClick: () => {
                  setSearchQuery('');
                  setSelectedCategory('Semua');
                  setStatusFilter('ACTIVE');
                  setStockFilter('ALL');
                },
              }}
            />
          ) : (
            filteredProducts.map((p) => (
              <div
                key={p.id}
                className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 hover:bg-surface-container transition-colors"
              >
                <Link href={`/admin/stockist/branch-stock/all/${p.id}?branch=${user?.branch || ''}`} className="flex items-center gap-3">
                  <div className="relative h-[66px] w-[66px] shrink-0 overflow-hidden rounded-xl border border-border-base bg-surface-container-lowest">
                    <img
                      className="h-full w-full object-cover opacity-85 mix-blend-luminosity"
                      src={getProductImage(p.sku, p.name)}
                      alt={p.name}
                    />
                    <span className={`absolute bottom-0 left-0 h-3 w-3 rounded-full border-[2.5px] border-surface-elevated ${STATUS_DOT[stockStatusFor(qtyByProduct.get(p.id) ?? 0, p.minimum_stock)]}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[13.5px] font-bold text-text-primary">{p.name}</h3>
                    <span className="block text-[10px] font-mono text-text-muted">{p.sku}</span>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider border ${
                        p.is_active
                          ? 'bg-success/10 border-success/30 text-success'
                          : 'bg-danger/10 border-danger/30 text-danger'
                      }`}>
                        {p.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${STATUS_BADGE[stockStatusFor(qtyByProduct.get(p.id) ?? 0, p.minimum_stock)]}`}>
                        {STATUS_LABEL[stockStatusFor(qtyByProduct.get(p.id) ?? 0, p.minimum_stock)]}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className={`text-[19px] font-bold font-display tabular-nums ${STATUS_TEXT[stockStatusFor(qtyByProduct.get(p.id) ?? 0, p.minimum_stock)]}`}>
                      {qtyByProduct.get(p.id) ?? 0}
                    </span>
                    <span className="text-[9px] text-text-muted">{p.unit}</span>
                  </div>
                  <span className="material-symbols-outlined shrink-0 text-[18px] text-text-muted">chevron_right</span>
                </Link>

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border-base/50 mt-1 text-[12px]">
                  <div className="flex flex-col">
                    <span className="text-text-muted font-medium text-[10px] uppercase tracking-wide">Kategori & Unit</span>
                    <span className="text-text-primary font-semibold mt-0.5">{p.category || 'Lainnya'} • {p.unit}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-text-muted font-medium text-[10px] uppercase tracking-wide">Harga Jual</span>
                    <span className="text-[14px] font-bold text-text-primary tabular-nums mt-0.5">
                      {p.retail_price != null ? formatCurrency(p.retail_price) : '-'}
                    </span>
                  </div>
                </div>

                {isOwner && editingId !== p.id && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => startEdit(p)}
                      className="flex-1 flex items-center justify-center gap-1.5 h-[36px] rounded-lg text-[12px] font-semibold bg-surface-container-low border border-border-base text-text-primary hover:border-primary-container active:scale-95 transition-all"
                    >
                      <span className="material-symbols-outlined text-[16px]">edit</span>
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggleActive(p)}
                      disabled={togglingId === p.id}
                      className={`flex-1 flex items-center justify-center gap-1.5 h-[36px] rounded-lg text-[12px] font-semibold border active:scale-95 transition-all ${
                        p.is_active
                          ? 'bg-danger/10 border-danger/30 text-danger hover:bg-danger/15'
                          : 'bg-success/10 border-success/30 text-success hover:bg-success/15'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">{p.is_active ? 'block' : 'check_circle'}</span>
                      {togglingId === p.id ? 'Memproses...' : p.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                  </div>
                )}

                {isOwner && editingId === p.id && editForm && (
                  <form onSubmit={handleSaveEdit} className="flex flex-col gap-3 pt-3 border-t border-border-base/50 mt-1">
                    {editError && (
                      <div className="bg-danger/10 border border-danger text-danger text-[12px] rounded-lg p-2.5 flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px]">error</span>
                        <span>{editError}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex flex-col gap-1.5 col-span-2">
                        <label className="text-[11px] font-medium text-text-secondary">SKU Produk *</label>
                        <input
                          value={editForm.sku}
                          onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })}
                          className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1.5 col-span-2">
                        <label className="text-[11px] font-medium text-text-secondary">Nama Produk *</label>
                        <input
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-text-secondary">Kategori</label>
                        <input
                          value={editForm.category}
                          onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                          className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-text-secondary">Satuan Unit</label>
                        <input
                          value={editForm.unit}
                          onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                          className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1.5 col-span-2">
                        <label className="text-[11px] font-medium text-text-secondary">Jenis Penggunaan</label>
                        <select value={editForm.product_type} onChange={(e) => setEditForm({ ...editForm, product_type: e.target.value as NonNullable<StockistProduct['product_type']> })} className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary">
                          <option value="RETAIL">Retail</option>
                          <option value="SERVICE_CONSUMABLE">Barang Pemakaian</option>
                          <option value="BOTH">Retail + Barang Pemakaian</option>
                          <option value="CONSUMABLE">Perlengkapan</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-text-secondary">Harga Beli</label>
                        <input
                          type="number"
                          value={editForm.purchase_price}
                          onChange={(e) => setEditForm({ ...editForm, purchase_price: e.target.value })}
                          className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-text-secondary">Harga Jual *</label>
                        <input
                          type="number"
                          value={editForm.retail_price}
                          onChange={(e) => setEditForm({ ...editForm, retail_price: e.target.value })}
                          className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-text-secondary">Minimum Stock</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.minimum_stock}
                          onChange={(e) => setEditForm({ ...editForm, minimum_stock: e.target.value })}
                          className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                          required
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setEditingId(null); setEditForm(null); }}
                        className="flex-1 h-[38px] rounded-lg text-xs font-semibold bg-surface-container-low border border-border-base text-text-secondary active:scale-95 transition-all"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        disabled={editSubmitting}
                        className="flex-1 h-[38px] rounded-lg text-xs font-bold bg-primary-container hover:bg-inverse-primary text-white active:scale-95 transition-all"
                      >
                        {editSubmitting ? 'Menyimpan...' : 'Simpan Perubahan'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}

const OWNER_BRANCHES = [
  ['bypass', 'Bypass'],
  ['sumber', 'Sumber'],
  ['samadikun', 'Samadikun'],
  ['csb', 'CSB Mall'],
  ['tegal', 'Tegal'],
] as const;

const BRANCH_NAMES: Record<string, string> = Object.fromEntries(OWNER_BRANCHES);

function OwnerInventoryView() {
  const PAGE_SIZE = 8;
  const [branch, setBranch] = useState<string>('bypass');
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [query, setQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'AMAN' | 'MENIPIS' | 'HABIS'>('ALL');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([listProducts(), getInventorySummary(branch)])
      .then(([{ products }, { balances }]) => {
        setProducts(products.filter((product) => product.is_active));
        setBalances(balances);
        setVisibleCount(PAGE_SIZE);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat produk cabang'))
      .finally(() => setLoading(false));
  }, [branch]);

  function handleScan(code: string) {
    setScannerOpen(false);
    const match = products.find((p) => p.barcode && p.barcode === code);
    if (match) {
      setQuery(match.sku);
    } else {
      setError('Produk dengan barcode ini tidak ditemukan.');
    }
  }

  const qtyByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));
  const rows = products
    .map((product) => {
      const qty = qtyByProduct.get(product.id) ?? 0;
      return { product, qty, status: stockStatusFor(qty, product.minimum_stock) };
    })
    .filter((row) => {
      const text = `${row.product.name} ${row.product.sku}`.toLowerCase();
      return text.includes(query.toLowerCase()) && (stockFilter === 'ALL' || row.status === stockFilter);
    });
  const visibleRows = rows.slice(0, visibleCount);
  const hasMoreRows = visibleCount < rows.length;

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <BackButton fallbackHref="/admin/stockist" />
      <header>
        <p className="text-[10px] uppercase tracking-[0.18em] text-primary-container font-semibold">Owner · Decision view</p>
        <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Produk</h2>
        <p className="text-[12px] text-text-muted mt-1">{BRANCH_NAMES[branch] || branch}</p>
      </header>

      <div className="flex flex-col gap-2">
        <select
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          className="w-full rounded-lg border border-border-base bg-surface-container-lowest px-3 py-2.5 text-xs text-text-secondary"
        >
          {OWNER_BRANCHES.map(([slug, label]) => <option key={slug} value={slug}>{label}</option>)}
        </select>
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }}
            placeholder="Cari produk atau SKU"
            className="w-full rounded-lg border border-border-base bg-surface-container-lowest py-2.5 pl-9 pr-10 text-sm text-text-primary placeholder:text-text-muted focus:border-primary-container focus:outline-none"
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
              onClick={() => { setStockFilter(value); setVisibleCount(PAGE_SIZE); }}
              className={`flex-none rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
                stockFilter === value ? 'border-primary-container bg-primary-container text-white' : 'border-border-base bg-surface-elevated text-text-secondary'
              }`}
            >
              {value === 'ALL' ? 'Semua' : value === 'AMAN' ? 'Aman' : value === 'MENIPIS' ? 'Menipis' : 'Habis'}
            </button>
          ))}
        </div>
      </div>
      <BarcodeScannerSheet open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />

      {error && <div className="bg-danger/10 border border-danger text-danger text-xs rounded-lg p-3">{error}</div>}
      {loading ? (
        <div className="py-12 text-center text-text-muted text-sm">Memuat produk…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="inventory_2"
          title="Tidak ada produk"
          subtitle="Coba ubah kata kunci pencarian atau filter status."
          action={{ label: 'Reset filter', onClick: () => { setQuery(''); setStockFilter('ALL'); } }}
        />
      ) : (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[13px] font-semibold text-text-secondary uppercase tracking-wide">Produk</h3>
            <span className="text-[11px] text-text-muted">Menampilkan {visibleRows.length} dari {rows.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {visibleRows.map((row) => (
              <Link
                key={row.product.id}
                href={`/admin/stockist/branch-stock/all/${row.product.id}?branch=${branch}`}
                className="flex items-center gap-3 rounded-xl border border-border-base bg-surface-elevated p-3 hover:border-primary-container/40 active:scale-[0.98] transition-all"
              >
                <div className="relative h-[66px] w-[66px] shrink-0 overflow-hidden rounded-xl border border-border-base bg-surface-container-lowest">
                  {getKnownProductImage(row.product.name) ? (
                    <img src={getKnownProductImage(row.product.name) as string} alt="" className="h-full w-full object-contain p-1" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center material-symbols-outlined text-text-muted">inventory_2</span>
                  )}
                  <span className={`absolute bottom-0 left-0 h-3 w-3 rounded-full border-[2.5px] border-surface-elevated ${STATUS_DOT[row.status]}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-[13.5px] font-bold text-text-primary">{row.product.name}</h4>
                  <span className="block text-[10px] font-mono text-text-muted">{row.product.sku}</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    {row.product.category && (
                      <span className="rounded border border-border-base bg-surface-container px-1.5 py-0.5 text-[9px] font-semibold text-text-secondary">{row.product.category}</span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${STATUS_BADGE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={`text-[19px] font-bold font-display tabular-nums ${STATUS_TEXT[row.status]}`}>{row.qty}</span>
                  <span className="text-[9px] text-text-muted">{row.product.unit}</span>
                </div>
                <span className="material-symbols-outlined shrink-0 text-[18px] text-text-muted">chevron_right</span>
              </Link>
            ))}
          </div>
          {hasMoreRows && (
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              className="w-full min-h-[44px] rounded-xl border border-border-base bg-surface-elevated text-[12px] font-semibold text-text-secondary hover:border-primary-container hover:text-text-primary transition-colors"
            >
              Tampilkan {Math.min(PAGE_SIZE, rows.length - visibleCount)} produk berikutnya
            </button>
          )}
        </section>
      )}
    </div>
  );
}
