'use client';
import { useEffect, useState, use as usePromise } from 'react';
import { getTransfer, receiveTransfer, type StockTransfer, type StockTransferItem } from '@/lib/stockistApi';

export default function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [transfer, setTransfer] = useState<StockTransfer | null>(null);
  const [items, setItems] = useState<StockTransferItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [receivedQty, setReceivedQty] = useState<Record<string, string>>({});

  async function refresh() {
    const { transfer, items } = await getTransfer(id);
    setTransfer(transfer);
    setItems(items);
    setReceivedQty(Object.fromEntries(items.map((i) => [i.id, String(i.quantity_received ?? i.quantity_sent)])));
  }

  useEffect(() => { refresh().catch((err) => setError(err.message)); }, [id]);

  async function handleReceive(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const payload = items.map((item) => ({ item_id: item.id, quantity_received: Number(receivedQty[item.id] ?? item.quantity_sent) }));
      const { has_discrepancy } = await receiveTransfer(id, payload);
      setSuccess(has_discrepancy ? 'Diterima — ada selisih jumlah, cek dashboard owner.' : 'Diterima sesuai jumlah kirim.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to confirm receipt');
    }
  }

  if (!transfer) return <p className="text-sm opacity-70">Memuat...</p>;

  return (
    <div>
      <h2 className="text-lg font-bold mb-1">{transfer.transfer_number}</h2>
      <p className="text-xs uppercase opacity-70 mb-3">{transfer.status}</p>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
      {success && <p className="text-green-400 text-sm mb-3">{success}</p>}

      <form onSubmit={handleReceive} className="space-y-2 text-sm">
        {items.map((item) => (
          <div key={item.id} className="flex justify-between items-center gap-2">
            <span>Dikirim: {item.quantity_sent}</span>
            <input
              type="number" min={0} disabled={transfer.status === 'RECEIVED'}
              value={receivedQty[item.id] ?? ''}
              onChange={(e) => setReceivedQty({ ...receivedQty, [item.id]: e.target.value })}
              className="w-24 p-2 rounded bg-black/40 border border-white/10"
            />
          </div>
        ))}
        {transfer.status === 'SENT' && (
          <button type="submit" className="w-full p-2 rounded font-medium" style={{ background: '#C72820' }}>
            Konfirmasi Diterima
          </button>
        )}
      </form>
    </div>
  );
}
