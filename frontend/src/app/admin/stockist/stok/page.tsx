'use client';

import Link from 'next/link';
import { useUser } from '@/hooks/useUser';

interface HubItem {
  key: string;
  name: string;
  desc: string;
  icon: string;
  tint: string;
  color: string;
  href: string;
}

const HUB_ITEMS: HubItem[] = [
  { key: 'produk', name: 'Produk', desc: 'Master produk, harga, stok minimum', icon: 'category', tint: 'bg-tint-info', color: 'text-info', href: '/admin/stockist/products' },
  { key: 'gudang', name: 'Gudang Pusat', desc: 'Stok pusat & penerimaan barang', icon: 'warehouse', tint: 'bg-tint-success', color: 'text-success', href: '/admin/stockist/warehouse' },
  { key: 'cabang', name: 'Stok Cabang', desc: 'Sebaran stok per cabang', icon: 'storefront', tint: 'bg-tint-warning', color: 'text-warning', href: '/admin/stockist/branch-stock' },
  { key: 'ledger', name: 'Inventory Ledger', desc: 'Semua pergerakan stok', icon: 'receipt_long', tint: 'bg-tint-danger', color: 'text-danger', href: '/admin/stockist/ledger' },
  { key: 'requests', name: 'Permintaan Stok', desc: 'Pengajuan dari cabang', icon: 'add_shopping_cart', tint: 'bg-tint-info', color: 'text-info', href: '/admin/stockist/requests' },
  { key: 'returns', name: 'Retur Barang', desc: 'Pengembalian & barang rusak', icon: 'keyboard_return', tint: 'bg-tint-warning', color: 'text-warning', href: '/admin/stockist/returns' },
  { key: 'insight', name: 'Insight', desc: 'Sinyal distribusi & restock', icon: 'lightbulb', tint: 'bg-tint-success', color: 'text-success', href: '/admin/stockist/insights' },
];

export default function StokHubPage() {
  const { user } = useUser();
  if (!user || user.role !== 'owner') return null;

  return (
    <div className="flex flex-col gap-2.5">
      {HUB_ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className="flex w-full items-center gap-3 rounded-2xl border border-border-base bg-surface-elevated p-4 shadow-[var(--shadow)] hover:border-danger/40 transition-colors"
        >
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.tint}`}>
            <span className={`material-symbols-outlined text-[21px] ${item.color}`}>{item.icon}</span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[14px] font-bold text-text-primary">{item.name}</span>
            <span className="text-[11px] text-text-secondary">{item.desc}</span>
          </span>
          <span className="material-symbols-outlined shrink-0 text-[20px] text-text-muted">chevron_right</span>
        </Link>
      ))}
    </div>
  );
}
