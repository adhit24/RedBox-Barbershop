'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { getInventorySummary, listProducts, type InventoryBalance, type StockistProduct } from '@/lib/stockistApi';
import { BackButton } from '@/components/stockist/BackButton';
import { getKnownProductImage } from '@/lib/stockist/productImage';

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
      <section className="flex flex-col gap-2"><div className="flex items-center justify-between px-1"><h3 className="text-[13px] font-semibold text-text-secondary uppercase tracking-wide">Produk cabang</h3><span className="text-[11px] text-text-muted">{rows.length} SKU</span></div>{rows.length === 0 ? <div className="bg-surface-elevated border border-border-base rounded-xl p-5 text-center text-text-muted text-sm">Belum ada produk aktif.</div> : rows.map((row) => <Link key={row.product.id} href={`/admin/stockist/branch-stock/all/${row.product.id}?branch=${slug}`} className="bg-surface-elevated border border-border-base rounded-xl p-3 flex gap-3 min-h-[64px] hover:border-primary-container/50 transition-colors"><div className="w-10 h-10 shrink-0 rounded-lg bg-surface-container-low flex items-center justify-center overflow-hidden">{getKnownProductImage(row.product.name) ? <img src={getKnownProductImage(row.product.name) as string} alt="" className="w-full h-full object-contain p-1" /> : <span className="material-symbols-outlined text-text-muted">inventory_2</span>}</div><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><div><p className="text-[12px] font-semibold text-text-primary truncate">{row.product.name}</p><p className="text-[10px] text-text-muted font-mono">{row.product.sku}</p></div><p className={`text-[13px] font-bold tabular-nums ${row.status === 'OUT' ? 'text-danger' : row.status === 'LOW' ? 'text-status-menipis' : 'text-text-primary'}`}>{row.quantity} <span className="text-[10px] font-normal text-text-muted">{row.product.unit}</span></p></div><p className={`text-[10px] mt-1 ${row.status === 'OUT' ? 'text-danger' : row.status === 'LOW' ? 'text-status-menipis' : 'text-success'}`}>{row.status === 'OUT' ? 'Habis' : row.status === 'LOW' ? 'Menipis' : 'Aman'}</p></div><span className="material-symbols-outlined self-center text-text-muted text-[18px]">chevron_right</span></Link>)}</section>
    </>}
  </div>;
}
