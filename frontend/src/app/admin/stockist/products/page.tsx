'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { listProducts, createProduct, updateProduct, deactivateProduct, activateProduct, getInventorySummary, type StockistProduct } from '@/lib/stockistApi';
import { BackButton } from '@/components/stockist/BackButton';
import { getKnownProductImage } from '@/lib/stockist/productImage';

type EditForm = {
  sku: string; name: string; unit: string; category: string; brand: string;
  purchase_price: string; retail_price: string; minimum_stock: string;
  product_type: NonNullable<StockistProduct['product_type']>;
};

export default function ProductsPage() {
  const { user } = useUser();
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Semua');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ACTIVE');

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
      const { products } = await listProducts();
      setProducts(products);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat produk');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

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

  // Filter products
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'Semua' || p.category === selectedCategory;
    const matchesStatus = statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? p.is_active : !p.is_active);
    return matchesSearch && matchesCategory && matchesStatus;
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
            className="flex items-center gap-1.5 px-3 py-2 bg-primary-container text-text-primary text-[12px] font-semibold rounded-lg hover:bg-inverse-primary transition-all active:scale-95 border border-[#302728]"
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
                className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[11px] font-medium text-text-secondary">Nama Produk *</label>
              <input
                placeholder="Mis: RedBox Matte Clay Premium"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-text-secondary">Kategori</label>
              <input
                placeholder="Pomade, Equipment, etc."
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-text-secondary">Satuan Unit</label>
              <input
                placeholder="pcs, botol, pack"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[11px] font-medium text-text-secondary">Jenis Penggunaan</label>
              <select value={form.product_type} onChange={(e) => setForm({ ...form, product_type: e.target.value as NonNullable<StockistProduct['product_type']> })} className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary">
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
                className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-text-secondary">Harga Jual *</label>
              <input
                type="number"
                placeholder="Harga Retail"
                value={form.retail_price}
                onChange={(e) => setForm({ ...form, retail_price: e.target.value })}
                className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors"
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
                className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors"
                required
              />
            </div>
            
            <div className="flex items-end col-span-1 pt-1.5">
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary-container hover:bg-inverse-primary text-text-primary font-bold text-xs h-[38px] rounded-lg flex items-center justify-center gap-1 active:scale-95 transition-all shadow border border-[#302728]"
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
            className="w-full bg-[#171415] border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted transition-colors"
          />
        </div>

        {/* Status Chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {([['ACTIVE', 'Aktif'], ['INACTIVE', 'Nonaktif'], ['ALL', 'Semua Status']] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={`whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                statusFilter === value
                  ? 'bg-primary-container border-primary-container text-text-primary'
                  : 'bg-surface-container-low border-border-base text-text-secondary hover:border-text-muted'
              }`}
            >
              {label}
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
                    ? 'bg-primary-container border-primary-container text-text-primary'
                    : 'bg-surface-container-low border-border-base text-text-secondary hover:border-text-muted'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </section>

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
            <p className="text-center text-text-muted text-sm py-8 bg-surface-elevated border border-border-base rounded-xl">
              Tidak ada produk ditemukan.
            </p>
          ) : (
            filteredProducts.map((p) => (
              <div 
                key={p.id} 
                className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 hover:bg-surface-container transition-colors"
              >
                <div className="flex gap-3 items-start">
                  {/* Thumbnail */}
                  <div className="w-12 h-12 rounded-lg bg-[#171415] border border-border-base overflow-hidden flex-shrink-0 flex items-center justify-center">
                    <img 
                      className="w-full h-full object-cover opacity-85 mix-blend-luminosity" 
                      src={getProductImage(p.sku, p.name)} 
                      alt={p.name} 
                    />
                  </div>

                  {/* Core info */}
                  <div className="flex-grow flex flex-col justify-center min-h-[48px]">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <h3 className="font-semibold text-text-primary text-[14px] leading-tight">{p.name}</h3>
                        <span className="text-[10px] text-text-muted mt-1 font-mono block">SKU: {p.sku}</span>
                      </div>
                      <span className={`px-2 py-0.5 text-[9px] font-semibold rounded border uppercase tracking-wider ${
                        p.is_active 
                          ? 'bg-success/10 border-success/30 text-success' 
                          : 'bg-danger/10 border-danger/30 text-danger'
                      }`}>
                        {p.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>
                  </div>
                </div>

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
                          className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1.5 col-span-2">
                        <label className="text-[11px] font-medium text-text-secondary">Nama Produk *</label>
                        <input
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-text-secondary">Kategori</label>
                        <input
                          value={editForm.category}
                          onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                          className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-text-secondary">Satuan Unit</label>
                        <input
                          value={editForm.unit}
                          onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                          className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1.5 col-span-2">
                        <label className="text-[11px] font-medium text-text-secondary">Jenis Penggunaan</label>
                        <select value={editForm.product_type} onChange={(e) => setEditForm({ ...editForm, product_type: e.target.value as NonNullable<StockistProduct['product_type']> })} className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary">
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
                          className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-text-secondary">Harga Jual *</label>
                        <input
                          type="number"
                          value={editForm.retail_price}
                          onChange={(e) => setEditForm({ ...editForm, retail_price: e.target.value })}
                          className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
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
                          className="w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary-container"
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
                        className="flex-1 h-[38px] rounded-lg text-xs font-bold bg-primary-container hover:bg-inverse-primary text-text-primary active:scale-95 transition-all border border-[#302728]"
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

function OwnerInventoryView() {
  const PAGE_SIZE = 8;
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<Record<string, Map<string, number>>>({});
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | 'SAFE' | 'LOW' | 'OUT'>('ALL');
  const [branch, setBranch] = useState('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listProducts(), ...OWNER_BRANCHES.map(([slug]) => getInventorySummary(slug))])
      .then(([productResult, ...branchResults]) => {
        setProducts(productResult.products.filter((product) => product.is_active));
        const next: Record<string, Map<string, number>> = {};
        OWNER_BRANCHES.forEach(([slug], index) => {
          next[slug] = new Map((branchResults[index] as { balances: Array<{ product_id: string; quantity: number }> }).balances.map((balance) => [balance.product_id, balance.quantity]));
        });
        setBalances(next);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat inventory lintas cabang'))
      .finally(() => setLoading(false));
  }, []);

  const rows = products.map((product) => {
    const distribution = OWNER_BRANCHES.map(([slug, label]) => ({ slug, label, quantity: balances[slug]?.get(product.id) ?? 0 }));
    const total = distribution.reduce((sum, item) => sum + item.quantity, 0);
    const low = distribution.filter((item) => item.quantity > 0 && item.quantity <= product.minimum_stock).length;
    const out = distribution.filter((item) => item.quantity === 0).length;
    const productStatus = out === OWNER_BRANCHES.length ? 'OUT' : out > 0 || low > 0 ? 'LOW' : 'SAFE';
    return { product, distribution, total, low, out, productStatus };
  }).filter((row) => {
    const text = `${row.product.name} ${row.product.sku}`.toLowerCase();
    const branchMatch = branch === 'ALL' || row.distribution.some((item) => item.slug === branch && item.quantity > 0);
    return text.includes(query.toLowerCase()) && (status === 'ALL' || row.productStatus === status) && branchMatch;
  });
  const visibleRows = rows.slice(0, visibleCount);
  const hasMoreRows = visibleCount < rows.length;

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <BackButton fallbackHref="/admin/stockist" />
      <header>
        <p className="text-[10px] uppercase tracking-[0.18em] text-primary-container font-semibold">Owner · Decision view</p>
        <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Inventory</h2>
        <p className="text-[12px] text-text-muted mt-1">Distribusi stok aktif di seluruh cabang.</p>
      </header>
      <section className="flex flex-col gap-2">
        <input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); setExpandedId(null); }} placeholder="Cari produk atau SKU" className="w-full bg-[#171415] border border-border-base text-text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-primary-container placeholder:text-text-muted" />
        <div className="grid grid-cols-2 gap-2">
          <select value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setVisibleCount(PAGE_SIZE); setExpandedId(null); }} className="bg-[#171415] border border-border-base text-text-secondary text-xs rounded-lg px-3 py-2.5"><option value="ALL">Semua status</option><option value="SAFE">Aman</option><option value="LOW">Menipis</option><option value="OUT">Habis</option></select>
          <select value={branch} onChange={(event) => { setBranch(event.target.value); setVisibleCount(PAGE_SIZE); setExpandedId(null); }} className="bg-[#171415] border border-border-base text-text-secondary text-xs rounded-lg px-3 py-2.5"><option value="ALL">Semua cabang</option>{OWNER_BRANCHES.map(([slug, label]) => <option key={slug} value={slug}>{label}</option>)}</select>
        </div>
      </section>
      {error && <div className="bg-danger/10 border border-danger text-danger text-xs rounded-lg p-3">{error}</div>}
      {loading ? <div className="py-12 text-center text-text-muted text-sm">Memuat distribusi inventory…</div> : rows.length === 0 ? <div className="bg-surface-elevated border border-border-base rounded-xl p-6 text-center text-text-muted text-sm">Tidak ada produk yang sesuai filter.</div> : (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1"><h3 className="text-[13px] font-semibold text-text-secondary uppercase tracking-wide">Produk lintas cabang</h3><span className="text-[11px] text-text-muted">Menampilkan {visibleRows.length} dari {rows.length}</span></div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {visibleRows.map((row) => {
              const expanded = expandedId === row.product.id;
              return <div key={row.product.id} className="bg-surface-elevated border border-border-base rounded-xl overflow-hidden transition-colors hover:border-primary-container/50">
                <button type="button" onClick={() => setExpandedId(expanded ? null : row.product.id)} aria-expanded={expanded} className="w-full text-left p-3 flex gap-3 min-h-[88px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container/50">
                  <div className="w-12 h-12 shrink-0 rounded-lg bg-surface-container-low flex items-center justify-center overflow-hidden">{getKnownProductImage(row.product.name) ? <img src={getKnownProductImage(row.product.name) as string} alt="" className="w-full h-full object-contain p-1" /> : <span className="material-symbols-outlined text-text-muted">inventory_2</span>}</div>
                  <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><h4 className="text-[13px] font-semibold text-text-primary truncate">{row.product.name}</h4><p className="text-[10px] text-text-muted font-mono">{row.product.sku}</p></div><span className={`text-[10px] font-semibold ${row.productStatus === 'OUT' ? 'text-danger' : row.productStatus === 'LOW' ? 'text-status-menipis' : 'text-success'}`}>{row.productStatus === 'OUT' ? 'Habis' : row.productStatus === 'LOW' ? 'Perlu perhatian' : 'Aman'}</span></div><div className="flex items-end justify-between mt-2"><div><p className="text-[18px] font-bold text-text-primary tabular-nums">{row.total} <span className="text-[11px] font-normal text-text-muted">{row.product.unit} total</span></p><p className="text-[10px] text-text-muted">{row.low} menipis · {row.out} habis · {OWNER_BRANCHES.length} cabang</p></div><span className="material-symbols-outlined text-text-muted text-[18px]">{expanded ? 'expand_less' : 'expand_more'}</span></div></div>
                </button>
                {expanded && <div className="border-t border-border-base px-3 pb-3 pt-2 animate-slide-up"><p className="text-[10px] uppercase tracking-wide text-text-muted mb-2">Distribusi stok</p><div className="grid grid-cols-2 gap-1.5">{row.distribution.map((item) => <div key={item.slug} className="flex items-center justify-between rounded-lg bg-surface-container-low px-2.5 py-2"><span className="text-[10px] text-text-secondary">{item.label}</span><span className={`text-[11px] font-semibold ${item.quantity === 0 ? 'text-danger' : item.quantity <= row.product.minimum_stock ? 'text-status-menipis' : 'text-text-primary'}`}>{item.quantity} {row.product.unit}</span></div>)}</div><div className="flex items-center justify-between mt-3"><span className="text-[10px] text-text-muted">Informasi teknis tersedia di detail produk.</span><Link href={`/admin/stockist/branch-stock/all/${row.product.id}?branch=bypass`} className="text-[11px] font-semibold text-primary-container px-2 py-1.5 rounded-lg hover:bg-primary-container/10">Lihat detail</Link></div></div>}
              </div>;
            })}
          </div>
          {hasMoreRows && <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="w-full min-h-[44px] rounded-xl border border-border-base bg-surface-elevated text-[12px] font-semibold text-text-secondary hover:border-primary-container hover:text-text-primary transition-colors">Tampilkan {Math.min(PAGE_SIZE, rows.length - visibleCount)} produk berikutnya</button>}
        </section>
      )}
    </div>
  );
}
