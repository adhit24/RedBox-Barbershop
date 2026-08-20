'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { getAssetDashboard, getInventorySummary, listProducts, type StockistAssetDashboard, type StockistProduct } from '@/lib/stockistApi';
import { BackButton } from '@/components/stockist/BackButton';
import { EmptyState } from '@/components/stockist/EmptyState';

const BRANCHES = [['bypass', 'Bypass'], ['sumber', 'Sumber'], ['samadikun', 'Samadikun'], ['csb', 'CSB Mall'], ['tegal', 'Tegal']] as const;

type ProductSignal = { product: StockistProduct; distribution: Array<{ label: string; quantity: number }>; out: number; low: number; spread: number };

export default function OwnerInsightsPage() {
  const { user } = useUser();
  const [signals, setSignals] = useState<ProductSignal[]>([]);
  const [assets, setAssets] = useState<StockistAssetDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== 'owner') return;
    Promise.all([listProducts(), ...BRANCHES.map(([slug]) => getInventorySummary(slug)), getAssetDashboard()])
      .then(([productResult, ...rest]) => {
        const assetData = rest.pop() as StockistAssetDashboard;
        const products = productResult.products.filter((product) => product.is_active);
        const branchMaps = BRANCHES.map(([, label], index) => ({ label, map: new Map((rest[index] as { balances: Array<{ product_id: string; quantity: number }> }).balances.map((balance) => [balance.product_id, balance.quantity])) }));
        setSignals(products.map((product) => {
          const distribution = branchMaps.map(({ label, map }) => ({ label, quantity: map.get(product.id) ?? 0 }));
          const quantities = distribution.map((item) => item.quantity);
          return { product, distribution, out: quantities.filter((quantity) => quantity === 0).length, low: quantities.filter((quantity) => quantity > 0 && quantity <= product.minimum_stock).length, spread: Math.max(...quantities) - Math.min(...quantities) };
        }).filter((signal) => signal.out > 0 || signal.low > 0 || signal.spread > 0).sort((a, b) => (b.out * 100 + b.low * 10 + b.spread) - (a.out * 100 + a.low * 10 + a.spread)));
        setAssets(assetData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat insight inventory'))
      .finally(() => setLoading(false));
  }, [user?.role]);

  if (!user || user.role !== 'owner') return null;

  const highPriority = signals.filter((signal) => signal.out >= 2 || signal.spread >= 20);
  const watchList = signals.filter((signal) => !highPriority.includes(signal));

  return <div className="flex flex-col gap-5 animate-fade-in">
    <BackButton fallbackHref="/admin/stockist" />
    <header><p className="text-[10px] uppercase tracking-[0.18em] text-primary-container font-semibold">Owner · Current condition</p><h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Insight</h2><p className="text-[12px] text-text-muted mt-1">Sinyal keputusan dari kondisi stok saat ini. Tidak ada data historis yang dibuat-buat.</p></header>
    {error && <div className="bg-danger/10 border border-danger text-danger text-xs rounded-lg p-3">{error}</div>}
    {loading ? <div className="py-12 text-center text-text-muted text-sm">Menganalisis kondisi inventory…</div> : <>
      <section className="bg-surface-elevated border border-border-base rounded-xl p-4"><div className="flex items-center justify-between"><div><p className="text-[11px] uppercase tracking-wide text-text-muted">Produk perlu keputusan</p><p className="text-[28px] font-bold text-text-primary tabular-nums">{signals.length}</p></div><span className="material-symbols-outlined text-primary-container text-[28px]">lightbulb</span></div><p className="text-[11px] text-text-muted mt-2">Produk dengan stok habis, menipis, atau distribusi tidak merata.</p></section>
      <InsightGroup title="Butuh keputusan" signals={highPriority} emptyTitle="Tidak ada keputusan mendesak" emptySubtitle="Belum ada distribusi yang kritis saat ini." />
      <InsightGroup title="Perlu dipantau" signals={watchList} emptyTitle="Tidak ada sinyal tambahan" emptySubtitle="Kondisi inventory terlihat stabil." />
      {assets?.active_transfers.length === 0 && <EmptyState icon="local_shipping" title="Tidak ada transfer berjalan" subtitle="Tidak ada transfer yang sedang diproses." />}
    </>}
  </div>;
}

function InsightGroup({ title, signals, emptyTitle, emptySubtitle }: { title: string; signals: ProductSignal[]; emptyTitle: string; emptySubtitle: string }) {
  return <section className="flex flex-col gap-2"><h3 className="text-[13px] font-semibold text-text-secondary uppercase tracking-wide px-1">{title}</h3>{signals.length === 0 ? <EmptyState icon="check_circle" title={emptyTitle} subtitle={emptySubtitle} /> : signals.slice(0, 5).map((signal) => <Link key={signal.product.id} href="/admin/stockist/products" className="bg-surface-elevated border border-border-base rounded-xl p-3 hover:border-primary-container/50 transition-colors"><div className="flex items-start justify-between gap-3"><div><h4 className="text-[13px] font-semibold text-text-primary">{signal.product.name}</h4><p className="text-[10px] text-text-muted font-mono">{signal.product.sku}</p></div><span className="text-[10px] text-primary-container font-semibold">Lihat distribusi</span></div><div className="flex flex-wrap gap-1.5 mt-3">{signal.distribution.map((item) => <span key={item.label} className={`rounded-full px-2 py-1 text-[10px] ${item.quantity === 0 ? 'bg-danger/10 text-danger' : item.quantity <= signal.product.minimum_stock ? 'bg-status-menipis/10 text-status-menipis' : 'bg-surface-container-low text-text-secondary'}`}>{item.label} · {item.quantity}</span>)}</div><p className="text-[10px] text-text-muted mt-2">{signal.out} cabang habis · {signal.low} cabang menipis</p></Link>)}</section>;
}
