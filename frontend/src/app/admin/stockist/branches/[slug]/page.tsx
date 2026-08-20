'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { getInventorySummary, listProducts, type InventoryBalance, type StockistProduct } from '@/lib/stockistApi';
import { BackButton } from '@/components/stockist/BackButton';

const BRANCH_NAMES: Record<string, string> = { bypass: 'Cabang Bypass', sumber: 'Cabang Sumber', samadikun: 'Cabang Samadikun', csb: 'Cabang CSB Mall', tegal: 'Cabang Tegal' };

export default function OwnerBranchDetailPage() {
  const { user } = useUser();
  const params = useParams<{ slug: string }>();
  const slug = params?.slug || '';
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== 'owner' || !BRANCH_NAMES[slug]) return;
    Promise.all([listProducts(), getInventorySummary(slug)])
      .then(([productResult, balanceResult]) => { setProducts(productResult.products.filter((product) => product.is_active)); setBalances(balanceResult.balances); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat detail cabang'))
      .finally(() => setLoading(false));
  }, [slug, user?.role]);

  const rows = useMemo(() => {
    const byProduct = new Map(balances.map((balance) => [balance.product_id, balance.quantity]));
    return products.map((product) => { const quantity = byProduct.get(product.id) ?? 0; const status = quantity === 0 ? 'OUT' : quantity <= product.minimum_stock ? 'LOW' : 'SAFE'; return { product, quantity, status }; }).sort((a, b) => (a.status === 'OUT' ? -1 : a.status === 'LOW' ? 0 : 1) - (b.status === 'OUT' ? -1 : b.status === 'LOW' ? 0 : 1) || a.quantity - b.quantity);
  }, [balances, products]);
  const out = rows.filter((row) => row.status === 'OUT').length;
  const low = rows.filter((row) => row.status === 'LOW').length;
  const total = rows.reduce((sum, row) => sum + row.quantity, 0);

  if (!user || user.role !== 'owner' || !BRANCH_NAMES[slug]) return null;

  return <div className="flex flex-col gap-5 animate-fade-in">
    <BackButton fallbackHref="/admin/stockist/branch-stock" />
    <header><p className="text-[10px] uppercase tracking-[0.18em] text-primary-container font-semibold">Owner · Branch detail</p><h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">{BRANCH_NAMES[slug]}</h2><p className="text-[12px] text-text-muted mt-1">Ringkasan kondisi inventory lokasi ini.</p></header>
    {error && <div className="bg-danger/10 border border-danger text-danger text-xs rounded-lg p-3">{error}</div>}
    {loading ? <div className="py-12 text-center text-text-muted text-sm">Memuat detail cabang…</div> : <>
      <section className="grid grid-cols-2 gap-2"><div className="bg-surface-elevated border border-border-base rounded-xl p-3"><p className="text-[10px] text-text-muted uppercase">Total unit</p><p className="text-[24px] font-bold text-text-primary tabular-nums mt-1">{total}</p></div><div className="bg-surface-elevated border border-border-base rounded-xl p-3"><p className="text-[10px] text-text-muted uppercase">SKU aktif</p><p className="text-[24px] font-bold text-text-primary tabular-nums mt-1">{rows.length}</p></div><div className="bg-surface-elevated border border-border-base rounded-xl p-3"><p className="text-[10px] text-text-muted uppercase">Menipis</p><p className="text-[24px] font-bold text-status-menipis tabular-nums mt-1">{low}</p></div><div className="bg-surface-elevated border border-border-base rounded-xl p-3"><p className="text-[10px] text-text-muted uppercase">Habis</p><p className="text-[24px] font-bold text-danger tabular-nums mt-1">{out}</p></div></section>
      <section className="bg-surface-elevated border border-border-base rounded-xl p-4"><p className="text-[11px] uppercase tracking-wide text-text-muted">Insight cabang</p><p className="text-[13px] text-text-primary mt-2">{out + low === 0 ? 'Kondisi stok cabang aman saat ini.' : `${out + low} produk perlu perhatian: ${out} habis dan ${low} menipis.`}</p></section>
    </>}
  </div>;
}
