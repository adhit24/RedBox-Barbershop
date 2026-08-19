'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { listProducts, getInventorySummary, type StockistProduct, type InventoryBalance } from '@/lib/stockistApi';

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

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'SAFE' | 'LOW' | 'OUT'>('ALL');

  async function refresh() {
    if (!branch) return;
    setLoading(true);
    try {
      const [{ products }, { balances }] = await Promise.all([listProducts(), getInventorySummary(branch)]);
      setProducts(products);
      setBalances(balances);
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

  // Combine product and quantity info
  const enrichedProducts = products.map((p) => {
    const qty = quantityByProduct.get(p.id) ?? 0;
    const isOut = qty === 0;
    const isLow = qty > 0 && qty <= p.minimum_stock;
    const isSafe = qty > p.minimum_stock;
    
    let status: 'SAFE' | 'LOW' | 'OUT' = 'SAFE';
    if (isOut) status = 'OUT';
    else if (isLow) status = 'LOW';

    return { ...p, qty, status };
  });

  // Filter listings
  const filteredProducts = enrichedProducts.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    
    let matchesFilter = true;
    if (stockFilter === 'SAFE') matchesFilter = p.status === 'SAFE';
    else if (stockFilter === 'LOW') matchesFilter = p.status === 'LOW';
    else if (stockFilter === 'OUT') matchesFilter = p.status === 'OUT';

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
                className="bg-surface-elevated border border-border-base rounded-xl p-4 flex items-center gap-3 hover:border-primary-container transition-all"
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
                  <p className={`text-[18px] font-bold font-display tabular-nums leading-tight ${
                    p.status === 'OUT' ? 'text-danger' : p.status === 'LOW' ? 'text-status-menipis' : 'text-text-primary'
                  }`}>
                    {p.qty}
                  </p>
                  
                  {p.status === 'SAFE' && (
                    <span className="text-[10px] font-semibold mt-1 text-success flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
                      Aman
                    </span>
                  )}
                  {p.status === 'LOW' && (
                    <span className="text-[10px] font-semibold mt-1 text-status-menipis flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-status-menipis animate-pulse"></span>
                      Menipis
                    </span>
                  )}
                  {p.status === 'OUT' && (
                    <span className="text-[10px] font-semibold mt-1 text-danger flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-danger"></span>
                      Habis
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </section>
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
