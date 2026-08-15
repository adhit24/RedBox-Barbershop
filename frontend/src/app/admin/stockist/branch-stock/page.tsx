'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { listProducts, getInventorySummary, type StockistProduct, type InventoryBalance } from '@/lib/stockistApi';

export default function BranchStockPage() {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const branch = user?.role === 'owner' ? (searchParams.get('branch') || '') : (user?.branch || '');

  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!branch) return;
    Promise.all([listProducts(), getInventorySummary(branch)])
      .then(([{ products }, { balances }]) => { setProducts(products); setBalances(balances); })
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load stock'));
  }, [branch]);

  if (!branch) return <p className="text-sm opacity-70">Pilih cabang lewat parameter ?branch=</p>;

  const quantityByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));

  return (
    <div>
      <h2 className="text-lg font-bold mb-3 capitalize">Stok Cabang: {branch}</h2>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
      <ul className="space-y-2">
        {products.map((p) => {
          const qty = quantityByProduct.get(p.id) ?? 0;
          const low = qty <= p.minimum_stock;
          return (
            <li key={p.id} className="p-3 rounded border text-sm flex justify-between" style={{ borderColor: low ? '#C72820' : 'rgba(255,255,255,0.1)' }}>
              <span>{p.name}</span>
              <span>{qty} {p.unit}{low && <span className="ml-2 text-red-400">low</span>}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
