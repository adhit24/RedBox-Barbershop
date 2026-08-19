'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import {
  listProducts, getInventorySummary, getServiceUsage, getServiceUsagePicOptions,
  openServiceUsage, finishServiceUsage,
  type StockistProduct, type InventoryBalance, type ServiceUsage, type ServiceUsageItem,
} from '@/lib/stockistApi';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

function BranchStockContent() {
  const { user } = useUser();
  const searchParams = useSearchParams() || new URLSearchParams();
  const router = useRouter();
  const branch = user?.role === 'owner' ? (searchParams.get('branch') || 'bypass') : (user?.branch || '');

  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serviceItems, setServiceItems] = useState<ServiceUsageItem[]>([]);
  const [serviceUsages, setServiceUsages] = useState<ServiceUsage[]>([]);
  const [picOptions, setPicOptions] = useState<Array<{ id: string; name: string; role: 'branch_admin' | 'barber'; branch: string }>>([]);
  const [productTypeFilter, setProductTypeFilter] = useState<'ALL' | 'RETAIL' | 'SERVICE'>('ALL');
  const [openProduct, setOpenProduct] = useState<StockistProduct | null>(null);
  const [openQuantity, setOpenQuantity] = useState(1);
  const [openPic, setOpenPic] = useState('');
  const [openNotes, setOpenNotes] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const isOwner = user?.role === 'owner';

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'SAFE' | 'LOW' | 'OUT'>('ALL');

  async function refresh() {
    if (!branch) return;
    setLoading(true);
    try {
      const [{ products }, { balances }, serviceData, picData] = await Promise.all([
        listProducts(),
        getInventorySummary(branch),
        getServiceUsage(isOwner ? undefined : branch),
        getServiceUsagePicOptions(branch),
      ]);
      setProducts(products);
      setBalances(balances);
      setServiceItems(serviceData.items);
      setServiceUsages(serviceData.usages);
      setPicOptions(picData.people);
      setOpenPic(picData.people[0]?.id || '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat stok cabang');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [branch]);

  if (!branch) {
    return (
      <div className="bg-surface-elevated border border-border-base rounded-xl p-6 text-center text-text-muted">
        Pilih cabang terlebih dahulu.
      </div>
    );
  }

  const quantityByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));
  const serviceByProduct = new Map(serviceItems.filter((item) => item.branch === branch).map((item) => [item.id, item]));
  const isServiceProduct = (product: StockistProduct) => ['SERVICE', 'SERVICE_CONSUMABLE', 'BOTH'].includes(product.product_type || '');

  // Combine product and quantity info
  const enrichedProducts = products.map((p) => {
    const qty = quantityByProduct.get(p.id) ?? 0;
    const isOut = qty === 0;
    const isLow = qty > 0 && qty <= p.minimum_stock;
    const isSafe = qty > p.minimum_stock;
    
    let status: 'SAFE' | 'LOW' | 'OUT' = 'SAFE';
    if (isOut) status = 'OUT';
    else if (isLow) status = 'LOW';

    const service = serviceByProduct.get(p.id);
    return { ...p, qty, status, inUse: service?.in_use_quantity || 0 };
  });

  // Filter listings
  const filteredProducts = enrichedProducts.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesProductType = productTypeFilter === 'ALL'
      || (productTypeFilter === 'SERVICE' && isServiceProduct(p))
      || (productTypeFilter === 'RETAIL' && !isServiceProduct(p));
    
    let matchesFilter = true;
    if (stockFilter === 'SAFE') matchesFilter = p.status === 'SAFE';
    else if (stockFilter === 'LOW') matchesFilter = p.status === 'LOW';
    else if (stockFilter === 'OUT') matchesFilter = p.status === 'OUT';

    return matchesSearch && matchesFilter && matchesProductType;
  });

  const activeUsages = serviceUsages.filter((usage) => usage.status === 'IN_USE' && usage.branch === branch);
  const historyUsages = serviceUsages.filter((usage) => isOwner || usage.branch === branch);

  async function handleOpenService() {
    if (!openProduct) return;
    if (!confirm('Buka barang untuk pemakaian?\n\nBarang ini akan dicatat sebagai stok yang sedang digunakan untuk operasional cabang.')) return;
    setActionBusy(true);
    try {
      await openServiceUsage({ product_id: openProduct.id, quantity: openQuantity, pic_user_id: openPic || undefined, notes: openNotes || undefined });
      setOpenProduct(null);
      setOpenQuantity(1);
      setOpenNotes('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuka barang untuk pemakaian');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleFinishService(usage: ServiceUsage) {
    if (!confirm('Tandai barang sebagai habis?\n\nPastikan barang ini memang sudah selesai digunakan untuk operasional cabang.')) return;
    setActionBusy(true);
    try {
      await finishServiceUsage(usage.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menandai barang sebagai habis');
    } finally {
      setActionBusy(false);
    }
  }

  const getProductImage = (sku: string, name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('clay') || lowerName.includes('pomade')) return '/api/stockist/product-image/clay.jpeg';
    if (lowerName.includes('oil')) return '/api/stockist/product-image/oil_base.jpeg';
    if (lowerName.includes('water') || lowerName.includes('spray')) return '/api/stockist/product-image/water_base.jpeg';
    if (lowerName.includes('shave') || lowerName.includes('cream') || lowerName.includes('psyi')) return '/api/stockist/product-image/psyi.jpeg';
    return '/api/stockist/product-image/E_left_here.jpeg';
  };

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Header Context */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">
            {isOwner ? `Stok Cabang` : 'Stok Saya'}
          </h2>
          <p className="text-[12px] text-text-muted mt-1">
            {isOwner ? `Lokasi: ${BRANCH_NAMES[branch] || branch}` : `Cabang: ${BRANCH_NAMES[branch] || branch}`}
          </p>
        </div>
      </div>

      {/* Owner Branch Selector */}
      {isOwner && (
        <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-2 shadow-sm">
          <label className="text-[12px] font-semibold text-text-secondary">Pilih Cabang</label>
          <select 
            value={branch}
            onChange={(e) => router.push(`/admin/stockist/branch-stock?branch=${encodeURIComponent(e.target.value)}`)}
            className="w-full bg-[#171415] border border-border-base rounded-lg text-text-primary px-3 py-2.5 text-sm focus:outline-none focus:border-primary-container"
          >
            <option value="bypass">Cabang Bypass</option>
            <option value="sumber">Cabang Sumber</option>
            <option value="samadikun">Cabang Samadikun</option>
            <option value="csb">Cabang CSB Mall</option>
            <option value="tegal">Cabang Tegal</option>
          </select>
        </section>
      )}

      {/* Search & Filter section */}
      <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 shadow-sm">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Cari produk atau SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#171415] border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted transition-colors"
          />
        </div>

        {/* Stock status filter chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setStockFilter('ALL')}
            className={`whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${
              stockFilter === 'ALL'
                ? 'bg-primary-container border-primary-container text-text-primary'
                : 'bg-surface-container-low border-border-base text-text-secondary hover:border-text-muted'
            }`}
          >
            Semua
          </button>
          <button
            onClick={() => setStockFilter('SAFE')}
            className={`whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${
              stockFilter === 'SAFE'
                ? 'bg-success/15 border-success/40 text-success'
                : 'bg-surface-container-low border-border-base text-text-secondary hover:border-text-muted'
            }`}
          >
            Aman
          </button>
          <button
            onClick={() => setStockFilter('LOW')}
            className={`whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${
              stockFilter === 'LOW'
                ? 'bg-status-menipis/15 border-status-menipis/40 text-status-menipis'
                : 'bg-surface-container-low border-border-base text-text-secondary hover:border-text-muted'
            }`}
          >
            Menipis
          </button>
          <button
            onClick={() => setStockFilter('OUT')}
            className={`whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${
              stockFilter === 'OUT'
                ? 'bg-danger/15 border-danger/40 text-danger'
                : 'bg-surface-container-low border-border-base text-text-secondary hover:border-text-muted'
            }`}
          >
            Habis
          </button>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none border-t border-border-base pt-3">
          {([['ALL', 'Semua'], ['RETAIL', 'Retail'], ['SERVICE', 'Barang Pemakaian']] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setProductTypeFilter(value)}
              className={`whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${productTypeFilter === value ? 'bg-primary-container border-primary-container text-text-primary' : 'bg-surface-container-low border-border-base text-text-secondary hover:border-text-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Listing Area */}
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
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Daftar Stok</h3>
            <span className="text-[11px] text-text-muted">
              {filteredProducts.length} Produk
            </span>
          </div>

          {filteredProducts.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8 bg-surface-elevated border border-border-base rounded-xl">
              Tidak ada stok produk yang sesuai filter.
            </p>
          ) : (
            filteredProducts.map((p) => (
              <div
                key={p.id} 
                className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 hover:border-primary-container transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-[#171415] border border-border-base overflow-hidden flex-shrink-0 flex items-center justify-center">
                    <img className="w-full h-full object-cover opacity-85 mix-blend-luminosity" src={getProductImage(p.sku, p.name)} alt={p.name} />
                  </div>
                  <div className="flex-1 flex flex-col justify-center min-h-[48px]">
                    <h4 className="font-semibold text-text-primary text-[14px] leading-tight">{p.name}</h4>
                    <span className="text-[10px] text-text-muted mt-1 font-mono">SKU: {p.sku}</span>
                  </div>
                  <div className="flex flex-col items-end justify-center min-h-[48px]">
                    <p className={`text-[18px] font-bold font-display tabular-nums leading-tight ${p.status === 'OUT' ? 'text-danger' : p.status === 'LOW' ? 'text-status-menipis' : 'text-text-primary'}`}>{p.qty}</p>
                    <span className="text-[10px] font-semibold mt-1 text-text-muted">{p.status === 'SAFE' ? 'Aman' : p.status === 'LOW' ? 'Menipis' : 'Habis'}</span>
                  </div>
                </div>
                {isServiceProduct(p) && (
                  <div className="rounded-lg border border-primary-container/20 bg-primary-container/5 p-3 flex flex-col gap-2 text-[11px]">
                    <div className="flex justify-between text-text-secondary"><span>Stok siap pakai</span><strong className="text-text-primary">{p.qty} {p.unit}</strong></div>
                    <div className="flex justify-between text-text-secondary"><span>Sedang digunakan</span><strong className="text-accent-soft">{p.inUse} {p.unit}</strong></div>
                    {p.inUse > 0 && <span className="text-text-muted">PIC aktif: {activeUsages.filter((usage) => usage.product_id === p.id).map((usage) => usage.pic_name).join(', ')}</span>}
                    <div className="flex gap-2 pt-1">
                      {!isOwner && p.qty > 0 && <button onClick={() => { setOpenProduct(p); setOpenQuantity(1); }} className="flex-1 rounded-lg bg-primary-container text-text-primary py-2 font-semibold">Buka Barang</button>}
                      {p.inUse > 0 && <button onClick={() => { setProductTypeFilter('SERVICE'); window.setTimeout(() => document.getElementById('service-usage-history')?.scrollIntoView({ behavior: 'smooth' }), 0); }} className="flex-1 rounded-lg border border-border-base text-text-secondary py-2 font-semibold">Lihat Pemakaian</button>}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </section>
      )}
      {productTypeFilter === 'SERVICE' && activeUsages.length > 0 && (
        <section id="service-usage-history" className="flex flex-col gap-3">
          <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase px-1">Riwayat Pemakaian</h3>
          {historyUsages.map((usage) => (
            <div key={usage.id} className="bg-surface-elevated border border-border-base rounded-xl p-3 text-[11px] flex flex-col gap-1">
              <div className="flex justify-between gap-3"><strong className="text-text-primary">{usage.product_name}</strong><span className={usage.status === 'IN_USE' ? 'text-accent-soft' : 'text-text-muted'}>{usage.status === 'IN_USE' ? 'Sedang Dipakai' : 'Habis'}</span></div>
              <span className="text-text-muted">{usage.quantity} {usage.product_unit} · PIC {usage.pic_name}</span>
              <span className="text-text-muted">Dibuka {new Date(usage.opened_at).toLocaleString('id-ID')}</span>
              {!isOwner && usage.status === 'IN_USE' && <button onClick={() => void handleFinishService(usage)} disabled={actionBusy} className="mt-2 rounded-lg border border-border-base text-text-secondary py-2 font-semibold">Tandai Habis</button>}
            </div>
          ))}
        </section>
      )}
      {openProduct && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-end justify-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-[430px] bg-surface-elevated border border-border-base rounded-2xl p-4 flex flex-col gap-4">
            <div><h3 className="text-[16px] font-bold text-text-primary">Buka Barang</h3><p className="text-[12px] text-text-muted mt-1">{openProduct.name}</p></div>
            <label className="text-[12px] text-text-secondary">Quantity yang dibuka<input type="number" min={1} max={openProduct ? (quantityByProduct.get(openProduct.id) || 1) : 1} value={openQuantity} onChange={(e) => setOpenQuantity(Math.max(1, Number(e.target.value)))} className="mt-1 w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary" /></label>
            <label className="text-[12px] text-text-secondary">PIC / Penanggung Jawab<select value={openPic} onChange={(e) => setOpenPic(e.target.value)} className="mt-1 w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary"><option value="">Pilih PIC</option>{picOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            <label className="text-[12px] text-text-secondary">Catatan optional<textarea value={openNotes} onChange={(e) => setOpenNotes(e.target.value)} className="mt-1 w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary" rows={2} /></label>
            <div className="flex gap-2"><button onClick={() => setOpenProduct(null)} className="flex-1 border border-border-base rounded-lg py-2 text-text-secondary">Batal</button><button onClick={() => void handleOpenService()} disabled={actionBusy || !openPic} className="flex-1 bg-primary-container rounded-lg py-2 text-text-primary font-bold">{actionBusy ? 'Menyimpan...' : 'Ya, Buka Barang'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BranchStockPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <BranchStockContent />
    </Suspense>
  );
}
