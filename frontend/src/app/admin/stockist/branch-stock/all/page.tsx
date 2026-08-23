'use client';
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { Package, ChevronDown, ChevronUp, ArrowLeft, Layers, Grid } from 'lucide-react';
import {
  listProducts, getInventorySummary, getServiceUsage,
  type StockistProduct, type InventoryBalance,
} from '@/lib/stockistApi';
import { BottomSheet } from '@/components/stockist/BottomSheet';
import { EmptyState } from '@/components/stockist/EmptyState';
import { BackButton } from '@/components/stockist/BackButton';
import { getKnownProductImage } from '@/lib/stockist/productImage';
import {
  groupProductsByCategoryAndBrand,
  getCategoryForProduct,
  getBrandForProduct,
  type StandardCategory,
  type CategoryGroup,
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
  const initialCategoryParam = searchParams.get('category');

  const [stockFilter, setStockFilter] = useState<StockFilter>(isValidStockFilter(initialStatus) ? initialStatus : 'ALL');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategoryParam || 'ALL');
  const [viewMode, setViewMode] = useState<'CATEGORY' | 'FLAT'>('CATEGORY');
  const [collapsedBrands, setCollapsedBrands] = useState<Record<string, boolean>>({});

  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
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

  const updateCategoryUrl = (cat: string) => {
    setSelectedCategory(cat);
    const params = new URLSearchParams(searchParams.toString());
    if (cat === 'ALL') {
      params.delete('category');
    } else {
      params.set('category', cat);
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

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
    const matchesCategory = selectedCategory === 'ALL' || p.inferredCategory === selectedCategory;

    return matchesSearch && matchesType && matchesStock && matchesCategory;
  });

  const categoryGroups = groupProductsByCategoryAndBrand(filteredProducts);

  const visibleProducts = filteredProducts.slice(0, visibleCount);
  const hasMoreProducts = visibleCount < filteredProducts.length;
  const activeFilterCount = (stockFilter !== 'ALL' ? 1 : 0) + (typeFilter !== 'ALL' ? 1 : 0);
  const detailHrefFor = (id: string) => `/admin/stockist/branch-stock/all/${id}${isOwner ? `?branch=${branch}` : ''}`;

  const toggleBrandCollapse = (brandKey: string) => {
    setCollapsedBrands(prev => ({ ...prev, [brandKey]: !prev[brandKey] }));
  };

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

        {/* View mode toggle */}
        <div className="bg-[#171415] border border-border-base p-1 rounded-xl flex items-center gap-1">
          <button
            onClick={() => setViewMode('CATEGORY')}
            title="Tampilan Kategori & Merek"
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
              viewMode === 'CATEGORY' ? 'bg-primary-container text-white' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Layers size={14} />
            <span className="hidden sm:inline">Kategori</span>
          </button>
          <button
            onClick={() => setViewMode('FLAT')}
            title="Tampilan Grid Semua Produk"
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
              viewMode === 'FLAT' ? 'bg-primary-container text-white' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Grid size={14} />
            <span className="hidden sm:inline">Semua</span>
          </button>
        </div>
      </div>

      {/* Category Pills Slider */}
      <section className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => updateCategoryUrl('ALL')}
          className={`shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-semibold border transition-all ${
            selectedCategory === 'ALL'
              ? 'bg-primary-container border-primary-container text-white shadow-sm'
              : 'bg-surface-elevated border-border-base text-text-secondary hover:border-primary-container/40'
          }`}
        >
          Semua Kategori
        </button>
        {CATEGORIES_LIST.map((cat) => {
          const group = categoryGroups[cat];
          const count = group ? group.allProducts.length : 0;
          return (
            <button
              key={cat}
              onClick={() => updateCategoryUrl(cat)}
              className={`shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-semibold border transition-all ${
                selectedCategory === cat
                  ? 'bg-primary-container border-primary-container text-white shadow-sm'
                  : 'bg-surface-elevated border-border-base text-text-secondary hover:border-primary-container/40'
              }`}
            >
              <span>{cat}</span>
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                  selectedCategory === cat ? 'bg-white/20 text-white' : 'bg-surface-container-low text-text-muted'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </section>

      {/* Search & Filter Bar */}
      <section className="flex gap-2">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Cari produk atau SKU"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PRODUCT_PAGE_SIZE); }}
            className="w-full bg-[#171415] border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-primary-container placeholder:text-text-muted transition-colors"
          />
        </div>
        <button
          onClick={() => setFilterSheetOpen(true)}
          className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[13px] font-semibold ${
            activeFilterCount > 0 ? 'border-primary-container text-primary-container bg-primary-container/10' : 'border-border-base text-text-secondary'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">tune</span>
          {activeFilterCount > 0 ? `Filter · ${activeFilterCount}` : 'Filter'}
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
      ) : filteredProducts.length === 0 ? (
        <EmptyState icon="search_off" title="Tidak ada stok yang sesuai" subtitle="Coba ubah kata kunci pencarian atau filter kategori." />
      ) : viewMode === 'CATEGORY' && selectedCategory === 'ALL' ? (
        /* HIERARCHICAL MODE: Overview of Categories */
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Kategori Stok</h3>
            <span className="text-[11px] text-text-muted">Total {filteredProducts.length} Produk</span>
          </div>

          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3.5">
            {CATEGORIES_LIST.map((cat) => {
              const group = categoryGroups[cat];
              if (!group || group.allProducts.length === 0) return null;

              const outCount = group.allProducts.filter(p => p.status === 'OUT').length;
              const lowCount = group.allProducts.filter(p => p.status === 'LOW').length;

              return (
                <div
                  key={cat}
                  onClick={() => updateCategoryUrl(cat)}
                  className="bg-surface-elevated border border-border-base hover:border-primary-container/50 rounded-xl p-4 flex flex-col justify-between cursor-pointer transition-all active:scale-[0.99] group shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary-container/10 border border-primary-container/20 flex items-center justify-center text-primary-container group-hover:bg-primary-container group-hover:text-white transition-colors">
                        <span className="material-symbols-outlined text-[22px]">{group.iconName}</span>
                      </div>
                      <div>
                        <h4 className="font-bold text-text-primary text-[15px] group-hover:text-primary-container transition-colors">
                          {cat}
                        </h4>
                        <p className="text-[11px] text-text-muted">
                          {group.brands.length} Merek · {group.allProducts.length} Varian Produk
                        </p>
                      </div>
                    </div>
                    <span className="material-symbols-outlined text-text-muted text-[18px] group-hover:translate-x-1 transition-transform">
                      chevron_right
                    </span>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border-base/60 flex items-center justify-between text-[12px]">
                    <div className="flex items-center gap-2 font-display">
                      <span className="font-bold text-text-primary text-[14px]">{group.totalQuantity}</span>
                      <span className="text-[11px] text-text-muted">pcs total stok</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {outCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-danger/10 text-danger border border-danger/20">
                          {outCount} Habis
                        </span>
                      )}
                      {lowCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-status-menipis/10 text-status-menipis border border-status-menipis/20">
                          {lowCount} Menipis
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : viewMode === 'CATEGORY' && selectedCategory !== 'ALL' ? (
        /* HIERARCHICAL MODE: Focused Category View with Brands */
        <section className="flex flex-col gap-4">
          <div className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <button
                onClick={() => updateCategoryUrl('ALL')}
                className="flex items-center gap-1 text-[12px] text-primary-container font-semibold hover:underline"
              >
                <ArrowLeft size={14} />
                <span>Lihat semua kategori</span>
              </button>
              <span className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Kategori Khusus</span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-primary-container text-[26px]">
                  {categoryGroups[selectedCategory as StandardCategory]?.iconName || 'category'}
                </span>
                <div>
                  <h3 className="text-[18px] font-bold text-text-primary leading-tight">{selectedCategory}</h3>
                  <p className="text-[11px] text-text-muted">
                    {categoryGroups[selectedCategory as StandardCategory]?.brands.length || 0} Merek Terdaftar · {filteredProducts.length} Varian
                  </p>
                </div>
              </div>

              <div className="bg-surface-container-low px-3 py-1.5 rounded-lg border border-border-base text-right">
                <div className="text-[15px] font-bold font-display text-text-primary">
                  {categoryGroups[selectedCategory as StandardCategory]?.totalQuantity || 0} pcs
                </div>
                <div className="text-[10px] text-text-muted">Jumlah Stok</div>
              </div>
            </div>
          </div>

          {/* Grouped by Brand */}
          <div className="flex flex-col gap-4">
            {categoryGroups[selectedCategory as StandardCategory]?.brands.map((brandGroup) => {
              const brandKey = `${selectedCategory}-${brandGroup.brandName}`;
              const isCollapsed = collapsedBrands[brandKey];

              return (
                <div
                  key={brandGroup.brandName}
                  className="bg-surface-elevated border border-border-base rounded-xl overflow-hidden transition-all"
                >
                  {/* Brand Header */}
                  <div
                    onClick={() => toggleBrandCollapse(brandKey)}
                    className="p-3.5 bg-surface-container-low/60 border-b border-border-base flex items-center justify-between cursor-pointer hover:bg-surface-container-low transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-2 h-6 bg-primary-container rounded-full" />
                      <div>
                        <h4 className="font-bold text-text-primary text-[14px] leading-tight">
                          {brandGroup.brandName}
                        </h4>
                        <span className="text-[11px] text-text-muted">
                          {brandGroup.products.length} Varian / Ukuran
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className="text-[13px] font-bold font-display text-text-primary block">
                          {brandGroup.totalQuantity} pcs
                        </span>
                        <span className="text-[10px] text-text-muted block">Total Stok</span>
                      </div>
                      {isCollapsed ? <ChevronDown size={18} className="text-text-muted" /> : <ChevronUp size={18} className="text-text-muted" />}
                    </div>
                  </div>

                  {/* Brand Items Grid */}
                  {!isCollapsed && (
                    <div className="p-3 grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
                      {brandGroup.products.map((p) => {
                        const image = getKnownProductImage(p.name);
                        return (
                          <Link
                            key={p.id}
                            href={detailHrefFor(p.id)}
                            className="bg-[#171415] border border-border-base rounded-lg p-3 flex flex-col justify-between hover:border-primary-container/40 active:scale-[0.98] transition-all"
                          >
                            <div className="flex gap-2.5 items-start">
                              <div className="w-12 h-12 bg-surface-container-low rounded-lg shrink-0 flex items-center justify-center overflow-hidden border border-border-base/50">
                                {image ? (
                                  <img className="w-full h-full object-contain p-1" src={image} alt={p.name} />
                                ) : (
                                  <Package size={20} className="text-text-muted" aria-hidden />
                                )}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <h5 className="font-semibold text-text-primary text-[12px] leading-tight truncate">
                                  {p.name}
                                </h5>
                                <span className="text-[10px] text-text-muted font-mono mt-0.5">SKU {p.sku}</span>
                                {p.retail_price && (
                                  <span className="text-[10px] font-semibold text-primary-container mt-0.5">
                                    Rp {p.retail_price.toLocaleString('id-ID')}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between mt-3 pt-2 border-t border-border-base/40">
                              <span className="text-[10px] text-text-secondary">{TYPE_LABELS[p.typeKey]}</span>
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[13px] font-bold font-display tabular-nums ${
                                  p.status === 'OUT' ? 'text-danger' : p.status === 'LOW' ? 'text-status-menipis' : 'text-text-primary'
                                }`}>
                                  {p.qty} {p.unit}
                                </span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                                  p.status === 'OUT' ? 'bg-danger/10 text-danger' : p.status === 'LOW' ? 'bg-status-menipis/10 text-status-menipis' : 'bg-success/10 text-success'
                                }`}>
                                  {p.status === 'SAFE' ? 'Aman' : p.status === 'LOW' ? 'Menipis' : 'Habis'}
                                </span>
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
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
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#171415]/80 text-text-secondary border border-border-base backdrop-blur-sm">
                      {p.inferredCategory}
                    </span>
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
            <h4 className="text-[12px] font-semibold text-text-secondary mb-2">Status Stok</h4>
            <div className="flex flex-wrap gap-2">
              {([['ALL', 'Semua'], ['SAFE', 'Aman'], ['LOW', 'Menipis'], ['OUT', 'Habis']] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => { setStockFilter(value); setVisibleCount(PRODUCT_PAGE_SIZE); }}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border ${stockFilter === value ? 'bg-primary-container border-primary-container text-white' : 'bg-surface-container-low border-border-base text-text-secondary'}`}
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
