'use client';
import { useEffect, useState } from 'react';
import { listProducts, getInventorySummary, receiveWarehouseStock, type StockistProduct, type InventoryBalance } from '@/lib/stockistApi';

export default function WarehousePage() {
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [form, setForm] = useState({ product_id: '', quantity: '', reason: '' });
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [{ products }, { balances }] = await Promise.all([listProducts(), getInventorySummary('warehouse')]);
    setProducts(products);
    setBalances(balances);
  }

  useEffect(() => { refresh().catch((err) => setError(err.message)); }, []);

  async function handleReceive(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await receiveWarehouseStock({ product_id: form.product_id, quantity: Number(form.quantity), reason: form.reason || undefined });
      setForm({ product_id: '', quantity: '', reason: '' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to receive stock');
    }
  }

  const quantityByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));

  return (
    <div>
      <h2 className="text-lg font-bold mb-3">Stok Pusat</h2>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      <form onSubmit={handleReceive} className="grid grid-cols-2 gap-2 mb-6 text-sm">
        <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} className="col-span-2 p-2 rounded bg-black/40 border border-white/10" required>
          <option value="">Pilih produk</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
        </select>
        <input placeholder="Qty diterima" type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="p-2 rounded bg-black/40 border border-white/10" required />
        <input placeholder="Catatan (no. invoice)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="p-2 rounded bg-black/40 border border-white/10" />
        <button type="submit" className="col-span-2 p-2 rounded font-medium" style={{ background: '#C72820' }}>Terima Barang</button>
      </form>

      <ul className="space-y-2">
        {products.map((p) => (
          <li key={p.id} className="p-3 rounded border border-white/10 text-sm flex justify-between">
            <span>{p.name}</span>
            <span>{quantityByProduct.get(p.id) ?? 0} {p.unit}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
