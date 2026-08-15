'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { listProducts, createProduct, type StockistProduct } from '@/lib/stockistApi';

export default function ProductsPage() {
  const { user } = useUser();
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ sku: '', name: '', unit: 'pcs', purchase_price: '', retail_price: '' });

  async function refresh() {
    try {
      const { products } = await listProducts();
      setProducts(products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load products');
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createProduct({
        sku: form.sku, name: form.name, unit: form.unit,
        purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
        retail_price: form.retail_price ? Number(form.retail_price) : null,
      });
      setForm({ sku: '', name: '', unit: 'pcs', purchase_price: '', retail_price: '' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create product');
    }
  }

  return (
    <div>
      <h2 className="text-lg font-bold mb-3">Produk</h2>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {user?.role === 'owner' && (
        <form onSubmit={handleCreate} className="grid grid-cols-2 gap-2 mb-6 text-sm">
          <input placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="col-span-1 p-2 rounded bg-black/40 border border-white/10" required />
          <input placeholder="Nama produk" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-1 p-2 rounded bg-black/40 border border-white/10" required />
          <input placeholder="Harga beli" type="number" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} className="p-2 rounded bg-black/40 border border-white/10" />
          <input placeholder="Harga jual" type="number" value={form.retail_price} onChange={(e) => setForm({ ...form, retail_price: e.target.value })} className="p-2 rounded bg-black/40 border border-white/10" />
          <button type="submit" className="col-span-2 p-2 rounded font-medium" style={{ background: '#C72820' }}>Tambah Produk</button>
        </form>
      )}

      <ul className="space-y-2">
        {products.map((p) => (
          <li key={p.id} className="p-3 rounded border border-white/10 text-sm flex justify-between">
            <span>{p.name} <span className="opacity-50">({p.sku})</span></span>
            {p.retail_price != null && <span>Rp{p.retail_price.toLocaleString('id-ID')}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
