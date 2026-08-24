'use client';
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { Package } from 'lucide-react';
import {
  listProducts, getInventorySummary, getServiceUsage,
  type StockistProduct, type InventoryBalance,
} from '@/lib/stockistApi';
import { BottomSheet } from '@/components/stockist/BottomSheet';
import { EmptyState } from '@/components/stockist/EmptyState';
import { BackButton } from '@/components/stockist/BackButton';
import { BarcodeScannerSheet } from '@/components/stockist/BarcodeScannerSheet';
import { getKnownProductImage } from '@/lib/stockist/productImage';
import {
  getCategoryForProduct,
  getBrandForProduct,
  type StandardCategory,
} from '@/lib/stockist/categorization';

const TYPE_LABELS: Record<'RETAIL' | 'SERVICE' | 'CONSUMABLE', string> = {
  RETAIL: 'Retail',
  SERVICE: 'Barang Pemakaian',
  CONSUMABLE: 'Perlengkapan',
};

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

const CATEGORIES_LIST: StandardCategory[] = [
  'Pomade',
  'Parfume',
  'Perawatan Rambut',
  'Peralatan & Aksesoris',
  'Barang Pemakaian',
  'Perlengkapan',
  'Merchandise',
  'Lainnya'
];

type StockFilter = 'ALL' | 'SAFE' | 'LOW' | 'OUT';
type TypeFilter = 'ALL' | 'RETAIL' | 'SERVICE' | 'CONSUMABLE';
const PRODUCT_PAGE_SIZE = 6;

function isValidStockFilter(value: string | null): value is StockFilter {
  return value === 'SAFE' || value === 'LOW' || value === 'OUT' || value === 'ALL';
}

function SemuaStokContent() {
  const { user } = useUser();
  const searchParams = useSearchParams() || new URLSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const isOwner = user?.role === 'owner';
  const branch = isOwner ? (searchParams.get('branch') || 'bypass') : (user?.branch || '');

  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [inUseByProduct, setInUseByProduct] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const initialStatus = searchParams.get('status');

  const [stockFilter, setStockFilter] = useState<StockFilter>(isValidStockFilter(initialStatus) ? initialStatus : 'ALL');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');

  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PRODUCT_PAGE_SIZE);

  useEffect(() => {
    if (!branch) return;
    setLoading(true);
    Promise.all([listProducts(), getInventorySummary(branch), getServiceUsage(isOwner ? undefined : branch)])
      .then(([{ products }, { balances }, serviceData]) => {
        setProducts(products);
        setBalances(balances);
        setInUseByProduct(new Map(
          serviceData.items
            .filter((item) => item.branch === branch)
            .map((item) => [item.id, item.in_use_quantity])
        ));
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat stok cabang'))
      .finally(() => setLoading(false));
  }, [branch, isOwner]);

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
      const typeKey: 'RETAIL' | 'SERVICE' | 'CONSUMABLE' = isConsumableProduct(p) ? 'CONSUMABLE' : isServiceProduct(p) ? 'SERVICE' : 'RETAIL';
      const inferredCategory = getCategoryForProduct(p);
      const inferredBrand = getBrandForProduct(p);

      return {
        ...p,
        qty,
        status,
        typeKey,
        inferredCategory,
        inferredBrand,
        inUse: inUseByProduct.get(p.id) ?? 0
      };
    });

  const filteredProducts = enrichedProducts.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.inferredBrand.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.inferredCategory.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesType = typeFilter === 'ALL'
      || (typeFilter === 'SERVICE' && isServiceProduct(p))
      || (typeFilter === 'CONSUMABLE' && isConsumableProduct(p))
      || (typeFilter === 'RETAIL' && !isServiceProduct(p) && !isConsumableProduct(p));

    const matchesStock = stockFilter === 'ALL' || p.status === stockFilter;

    return matchesSearch && matchesType && matchesStock;
  });

  const visibleProducts = filteredProducts.slice(0, visibleCount);
  const hasMoreProducts = visibleCount < filteredProducts.length;
  const detailHrefFor = (id: string) => `/admin/stockist/branch-stock/all/${id}${isOwner ? `?branch=${branch}` : ''}`;

  function handleScan(code: string) {
    setScannerOpen(false);
    const match = products.find((p) => p.barcode && p.barcode === code);
    if (match) {
      setSearchQuery(match.sku);
      setVisibleCount(PRODUCT_PAGE_SIZE);
    } else {
      setError('Produk dengan barcode ini tidak ditemukan.');
    }
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in pb-12">
      <BackButton fallbackHref="/admin/stockist/branch-stock" />

      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Semua Stok</h2>
          <p className="text-[12px] text-text-muted mt-1">
            {isOwner ? `Lokasi: ${BRANCH_NAMES[branch] || branch}` : `Cabang: ${BRANCH_NAMES[branch] || branch}`}
          </p>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <section className="flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
            <input
              type="text"
              placeholder="Cari produk atau SKU"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PRODUCT_PAGE_SIZE); }}
              className="w-full bg-surface-container-lowest border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-10 py-2 focus:outline-none focus:border-primary-container placeholder:text-text-muted transition-colors"
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
          <button
            onClick={() => setFilterSheetOpen(true)}
            className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[13px] font-semibold ${
              typeFilter !== 'ALL' ? 'border-primary-container text-primary-container bg-primary-container/10' : 'border-border-base text-text-secondary'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">tune</span>
            {typeFilter !== 'ALL' ? 'Filter · 1' : 'Filter'}
          </button>
        </div>
        <div className="sc flex gap-2 overflow-x-auto pb-1">
          {(['ALL', 'SAFE', 'LOW', 'OUT'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => { setStockFilter(value); setVisibleCount(PRODUCT_PAGE_SIZE); }}
              className={`flex-none rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
                stockFilter === value ? 'border-primary-container bg-primary-container text-white' : 'border-border-base bg-surface-elevated text-text-secondary'
              }`}
            >
              {value === 'ALL' ? 'Semua' : value === 'SAFE' ? 'Aman' : value === 'LOW' ? 'Menipis' : 'Habis'}
            </button>
          ))}
        </div>
      </section>
      <BarcodeScannerSheet open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />

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
      ) : filteredProducts.length === 0 ? (
        <EmptyState icon="search_off" title="Tidak ada stok yang sesuai" subtitle="Coba ubah kata kunci pencarian atau filter kategori." />
      ) : (
        /* FLAT GRID MODE */
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Daftar Stok</h3>
            <span className="text-[11px] text-text-muted">Menampilkan {visibleProducts.length} dari {filteredProducts.length}</span>
          </div>

          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
            {visibleProducts.map((p) => {
              const image = getKnownProductImage(p.name);
              return (
                <Link
                  key={p.id}
                  href={detailHrefFor(p.id)}
                  className="bg-surface-elevated border border-border-base rounded-xl overflow-hidden flex flex-col active:scale-[0.98] hover:border-primary-container/40 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container/50"
                >
                  <div className="aspect-square bg-surface-container-low flex items-center justify-center overflow-hidden relative">
                    {image ? (
                      <img className="w-full h-full object-contain p-3 opacity-90" src={image} alt={p.name} />
                    ) : (
                      <Package size={32} className="text-text-muted" aria-hidden />
                    )}
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[9px] font-bold bg-surface-container-lowest/80 text-text-secondary border border-border-base backdrop-blur-sm">
                      {p.inferredCategory}
                    </span>
                    <span className={`absolute bottom-2 left-2 h-3 w-3 rounded-full border-[2.5px] border-surface-elevated ${
                      p.status === 'OUT' ? 'bg-danger' : p.status === 'LOW' ? 'bg-status-menipis' : 'bg-success'
                    }`} />
                  </div>
                  <div className="p-3 flex flex-col gap-1.5">
                    <h4 className="font-semibold text-text-primary text-[13px] leading-tight truncate">{p.name}</h4>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-text-muted font-mono">SKU {p.sku}</span>
                      <span className="text-text-muted font-medium">{p.inferredBrand}</span>
                    </div>
                    <span className="text-[10px] text-text-secondary">{TYPE_LABELS[p.typeKey]}</span>
                    <div className="flex items-center justify-between mt-1">
                      <div className="flex flex-col">
                        {p.typeKey === 'SERVICE' ? (
                          <>
                            <span className="text-[12px] font-bold font-display tabular-nums text-text-primary">{p.qty} {p.unit} tertutup</span>
                            {p.inUse > 0 && <span className="text-[10px] text-primary-container">{p.inUse} {p.unit} dipakai</span>}
                          </>
                        ) : (
                          <span className={`text-[14px] font-bold font-display tabular-nums ${p.status === 'OUT' ? 'text-danger' : p.status === 'LOW' ? 'text-status-menipis' : 'text-text-primary'}`}>{p.qty} {p.unit}</span>
                        )}
                      </div>
                      <span className={`text-[10px] font-semibold shrink-0 ${p.status === 'OUT' ? 'text-danger' : p.status === 'LOW' ? 'text-status-menipis' : 'text-success'}`}>
                        {p.status === 'SAFE' ? 'Aman' : p.status === 'LOW' ? 'Menipis' : 'Habis'}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {hasMoreProducts && (
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + PRODUCT_PAGE_SIZE)}
              className="w-full min-h-[44px] mt-1 rounded-xl border border-border-base bg-surface-elevated text-[12px] font-semibold text-text-secondary hover:border-primary-container hover:text-text-primary transition-colors"
            >
              Tampilkan produk ({Math.min(PRODUCT_PAGE_SIZE, filteredProducts.length - visibleCount)} lagi)
            </button>
          )}
        </section>
      )}

      {/* Filter BottomSheet */}
      <BottomSheet open={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} title="Filter">
        <div className="flex flex-col gap-4">
          <div>
            <h4 className="text-[12px] font-semibold text-text-secondary mb-2">Jenis Barang</h4>
            <div className="flex flex-wrap gap-2">
              {([['ALL', 'Semua'], ['RETAIL', 'Retail'], ['SERVICE', 'Barang Pemakaian'], ['CONSUMABLE', 'Perlengkapan']] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => { setTypeFilter(value); setVisibleCount(PRODUCT_PAGE_SIZE); }}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border ${typeFilter === value ? 'bg-primary-container border-primary-container text-white' : 'bg-surface-container-low border-border-base text-text-secondary'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={() => { setStockFilter('ALL'); setTypeFilter('ALL'); setVisibleCount(PRODUCT_PAGE_SIZE); }} className="flex-1 border border-border-base rounded-lg py-2 text-text-secondary font-semibold">Reset</button>
            <button onClick={() => setFilterSheetOpen(false)} className="flex-1 bg-primary-container rounded-lg py-2 text-white font-bold">Terapkan Filter</button>
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
