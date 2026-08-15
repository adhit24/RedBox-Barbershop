'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listProducts, createTransfer, type StockistProduct } from '@/lib/stockistApi';

const BRANCHES = ['bypass', 'sumber', 'samadikun', 'csb', 'tegal'];

export default function NewTransferPage() {
  const router = useRouter();
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [destination, setDestination] = useState('');
  const [lines, setLines] = useState([{ product_id: '', quantity: '' }]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProducts()
      .then(({ products }) => setProducts(products))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load products'));
  }, []);

  function updateLine(i: number, patch: Partial<{ product_id: string; quantity: string }>) {
    setLines((prev) => prev.map((line, idx) => (idx === i ? { ...line, ...patch } : line)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { transfer } = await createTransfer({
        destination_branch: destination,
        items: lines.filter((l) => l.product_id && l.quantity).map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) })),
      });
      router.push(`/admin/stockist/transfers/${transfer.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create transfer');
    }
  }

  return (
    <div>
      <h2 className="text-lg font-bold mb-3">Buat Transfer</h2>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-3 text-sm">
        <select value={destination} onChange={(e) => setDestination(e.target.value)} className="w-full p-2 rounded bg-black/40 border border-white/10" required>
          <option value="">Pilih cabang tujuan</option>
          {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>

        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-2 gap-2">
            <select value={line.product_id} onChange={(e) => updateLine(i, { product_id: e.target.value })} className="p-2 rounded bg-black/40 border border-white/10">
              <option value="">Pilih produk</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input type="number" min={1} placeholder="Qty" value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="p-2 rounded bg-black/40 border border-white/10" />
          </div>
        ))}
        <button type="button" onClick={() => setLines([...lines, { product_id: '', quantity: '' }])} className="text-xs underline opacity-70">
          + tambah produk
        </button>

        <button type="submit" className="w-full p-2 rounded font-medium" style={{ background: '#C72820' }}>Kirim</button>
      </form>
    </div>
  );
}
