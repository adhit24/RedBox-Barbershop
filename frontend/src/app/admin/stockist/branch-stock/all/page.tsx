'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import {
  listProducts, getInventorySummary,
  type StockistProduct, type InventoryBalance,
} from '@/lib/stockistApi';
import { BottomSheet } from '@/components/stockist/BottomSheet';
import { EmptyState } from '@/components/stockist/EmptyState';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

type StockFilter = 'ALL' | 'SAFE' | 'LOW' | 'OUT';
type TypeFilter = 'ALL' | 'RETAIL' | 'SERVICE' | 'CONSUMABLE';

function isValidStockFilter(value: string | null): value is StockFilter {
  return value === 'SAFE' || value === 'LOW' || value === 'OUT' || value === 'ALL';
}

function SemuaStokContent() {
  const { user } = useUser();
  const searchParams = useSearchParams() || new URLSearchParams();
  const isOwner = user?.role === 'owner';
  const branch = isOwner ? (searchParams.get('branch') || 'bypass') : (user?.branch || '');

  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const initialStatus = searchParams.get('status');
  const [stockFilter, setStockFilter] = useState<StockFilter>(isValidStockFilter(initialStatus) ? initialStatus : 'ALL');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  useEffect(() => {
    if (!branch) return;
    setLoading(true);
    Promise.all([listProducts(), getInventorySummary(branch)])
      .then(([{ products }, { balances }]) => {
        setProducts(products);
        setBalances(balances);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat stok cabang'))
      .finally(() => setLoading(false));
  }, [branch]);

  if (!branch) {
    return (
      <div className="bg-surface-elevated border border-border-base rounded-xl p-6 text-center text-text-muted">
        Pilih cabang terlebih dahulu.
      </div>
    );
  }

  const quantityByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));
  const isServiceProduct = (product: StockistProduct) => ['SERVICE', 'SERVICE_CONSUMABLE', 'BOTH'].includes(product.product_type || '');
  const isConsumableProduct = (product: StockistProduct) => product.product_type === 'CONSUMABLE';

  const enrichedProducts = products
    .filter((p) => p.is_active)
    .map((p) => {
      const qty = quantityByProduct.get(p.id) ?? 0;
      const isOut = qty === 0;
      const isLow = qty > 0 && qty <= p.minimum_stock;
      let status: 'SAFE' | 'LOW' | 'OUT' = 'SAFE';
      if (isOut) status = 'OUT';
      else if (isLow) status = 'LOW';
      return { ...p, qty, status };
    });

  const filteredProducts = enrichedProducts.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === 'ALL'
      || (typeFilter === 'SERVICE' && isServiceProduct(p))
      || (typeFilter === 'CONSUMABLE' && isConsumableProduct(p))
      || (typeFilter === 'RETAIL' && !isServiceProduct(p) && !isConsumableProduct(p));
    const matchesStock = stockFilter === 'ALL' || p.status === stockFilter;
    return matchesSearch && matchesType && matchesStock;
  });

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div>
        <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Semua Stok</h2>
        <p className="text-[12px] text-text-muted mt-1">
          {isOwner ? `Lokasi: ${BRANCH_NAMES[branch] || branch}` : `Cabang: ${BRANCH_NAMES[branch] || branch}`}
        </p>
      </div>

      <section className="flex gap-2">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Cari produk atau SKU"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#171415] border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-primary-container placeholder:text-text-muted transition-colors"
          />
        </div>
        <button
          onClick={() => setFilterSheetOpen(true)}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border-base text-text-secondary text-[13px] font-semibold"
        >
          <span className="material-symbols-outlined text-[18px]">tune</span>
          Filter
        </button>
      </section>

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
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Daftar Stok</h3>
            <span className="text-[11px] text-text-muted">{filteredProducts.length} Produk</span>
          </div>
          {filteredProducts.length === 0 ? (
            <EmptyState icon="search_off" title="Tidak ada stok yang sesuai" subtitle="Coba ubah kata kunci pencarian atau filter." />
          ) : (
            <div className="flex flex-col gap-2">
              {filteredProducts.map((p) => (
                <div key={p.id} className="bg-surface-elevated border border-border-base rounded-xl p-3 flex items-center gap-3">
                  <div className="flex-1 flex flex-col min-w-0">
                    <h4 className="font-semibold text-text-primary text-[14px] leading-tight truncate">{p.name}</h4>
                    <span className="text-[10px] text-text-muted mt-1 font-mono">SKU {p.sku}</span>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <p className={`text-[16px] font-bold font-display tabular-nums leading-tight ${p.status === 'OUT' ? 'text-danger' : p.status === 'LOW' ? 'text-status-menipis' : 'text-text-primary'}`}>{p.qty} {p.unit}</p>
                    <span className="text-[10px] font-semibold mt-1 text-text-muted">{p.status === 'SAFE' ? 'Aman' : p.status === 'LOW' ? 'Menipis' : 'Habis'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <BottomSheet open={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} title="Filter">
        <div className="flex flex-col gap-4">
          <div>
            <h4 className="text-[12px] font-semibold text-text-secondary mb-2">Status Stok</h4>
            <div className="flex flex-wrap gap-2">
              {([['ALL', 'Semua'], ['SAFE', 'Aman'], ['LOW', 'Menipis'], ['OUT', 'Habis']] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setStockFilter(value)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border ${stockFilter === value ? 'bg-primary-container border-primary-container text-text-primary' : 'bg-surface-container-low border-border-base text-text-secondary'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-[12px] font-semibold text-text-secondary mb-2">Jenis Barang</h4>
            <div className="flex flex-wrap gap-2">
              {([['ALL', 'Semua'], ['RETAIL', 'Retail'], ['SERVICE', 'Barang Pemakaian'], ['CONSUMABLE', 'Perlengkapan']] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setTypeFilter(value)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border ${typeFilter === value ? 'bg-primary-container border-primary-container text-text-primary' : 'bg-surface-container-low border-border-base text-text-secondary'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={() => { setStockFilter('ALL'); setTypeFilter('ALL'); }} className="flex-1 border border-border-base rounded-lg py-2 text-text-secondary font-semibold">Reset</button>
            <button onClick={() => setFilterSheetOpen(false)} className="flex-1 bg-primary-container rounded-lg py-2 text-text-primary font-bold">Terapkan Filter</button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

export default function SemuaStokPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <SemuaStokContent />
    </Suspense>
  );
}
