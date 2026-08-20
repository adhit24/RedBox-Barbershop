'use client';
import { useEffect, useState, Suspense, use as usePromise } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { Package } from 'lucide-react';
import {
  listProducts, getInventorySummary, getServiceUsage,
  type StockistProduct, type InventoryBalance,
} from '@/lib/stockistApi';
import { BackButton } from '@/components/stockist/BackButton';
import { getKnownProductImage } from '@/lib/stockist/productImage';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

const TYPE_LABELS: Record<string, string> = {
  RETAIL: 'Retail',
  SERVICE: 'Barang Pemakaian',
  SERVICE_CONSUMABLE: 'Barang Pemakaian',
  BOTH: 'Barang Pemakaian',
  CONSUMABLE: 'Perlengkapan',
};

function ProductDetailContent({ id }: { id: string }) {
  const { user } = useUser();
  const searchParams = useSearchParams() || new URLSearchParams();
  const isOwner = user?.role === 'owner';
  const branch = isOwner ? (searchParams.get('branch') || 'bypass') : (user?.branch || '');

  const [product, setProduct] = useState<StockistProduct | null>(null);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [inUse, setInUse] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!branch) return;
    setLoading(true);
    Promise.all([listProducts(), getInventorySummary(branch), getServiceUsage(isOwner ? undefined : branch)])
      .then(([{ products }, { balances }, serviceData]) => {
        setProduct(products.find((p) => p.id === id) ?? null);
        setBalances(balances);
        const item = serviceData.items.find((i) => i.id === id && i.branch === branch);
        setInUse(item?.in_use_quantity ?? 0);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat detail produk'))
      .finally(() => setLoading(false));
  }, [branch, id, isOwner]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <BackButton fallbackHref="/admin/stockist/branch-stock/all" />
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex flex-col gap-3">
        <BackButton fallbackHref="/admin/stockist/branch-stock/all" />
        <div className="bg-surface-elevated border border-border-base rounded-xl p-6 text-center text-text-muted text-sm">
          Produk tidak ditemukan.
        </div>
      </div>
    );
  }

  const qty = balances.find((b) => b.product_id === product.id)?.quantity ?? 0;
  const isOut = qty === 0;
  const isLow = qty > 0 && qty <= product.minimum_stock;
  const status: 'SAFE' | 'LOW' | 'OUT' = isOut ? 'OUT' : isLow ? 'LOW' : 'SAFE';
  const statusLabel = status === 'SAFE' ? 'Aman' : status === 'LOW' ? 'Menipis' : 'Habis';
  const statusColor = status === 'OUT' ? 'text-danger' : status === 'LOW' ? 'text-status-menipis' : 'text-success';
  const typeKey = product.product_type || 'RETAIL';
  const isServiceType = typeKey === 'SERVICE' || typeKey === 'SERVICE_CONSUMABLE' || typeKey === 'BOTH';
  const image = getKnownProductImage(product.name);

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <BackButton fallbackHref="/admin/stockist/branch-stock/all" />

      <div className="aspect-[4/3] w-full bg-surface-container-low border border-border-base rounded-2xl flex items-center justify-center overflow-hidden">
        {image ? (
          <img className="w-full h-full object-contain p-6 opacity-90" src={image} alt={product.name} />
        ) : (
          <Package size={56} className="text-text-muted" aria-hidden />
        )}
      </div>

      <div>
        <h2 className="text-[22px] font-bold text-text-primary font-display leading-tight">{product.name}</h2>
        <p className="text-[12px] text-text-muted mt-1 font-mono">SKU {product.sku}</p>
      </div>

      <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-text-secondary">Jenis Barang</span>
          <span className="text-[13px] font-semibold text-text-primary">{TYPE_LABELS[typeKey] || 'Retail'}</span>
        </div>
        {product.category && (
          <div className="flex justify-between items-center">
            <span className="text-[12px] text-text-secondary">Kategori</span>
            <span className="text-[13px] font-semibold text-text-primary">{product.category}</span>
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-text-secondary">Status</span>
          <span className={`text-[13px] font-bold ${statusColor}`}>{statusLabel}</span>
        </div>
      </section>

      <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3">
        <h3 className="text-[12px] font-semibold text-text-secondary uppercase tracking-wide">Stok — {isOwner ? BRANCH_NAMES[branch] || branch : 'Cabang Anda'}</h3>
        {isServiceType ? (
          <>
            <div className="flex justify-between items-center">
              <span className="text-[12px] text-text-secondary">Stok tertutup</span>
              <span className="text-[16px] font-bold font-display tabular-nums text-text-primary">{qty} {product.unit}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[12px] text-text-secondary">Sedang digunakan</span>
              <span className="text-[16px] font-bold font-display tabular-nums text-primary-container">{inUse} {product.unit}</span>
            </div>
          </>
        ) : (
          <div className="flex justify-between items-center">
            <span className="text-[12px] text-text-secondary">Stok saat ini</span>
            <span className={`text-[16px] font-bold font-display tabular-nums ${statusColor}`}>{qty} {product.unit}</span>
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-text-secondary">Minimum Stock</span>
          <span className="text-[13px] font-semibold text-text-muted tabular-nums">{product.minimum_stock} {product.unit}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-text-secondary">Reorder Point</span>
          <span className="text-[13px] font-semibold text-text-muted tabular-nums">{product.reorder_point} {product.unit}</span>
        </div>
      </section>
    </div>
  );
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <ProductDetailContent id={id} />
    </Suspense>
  );
}
