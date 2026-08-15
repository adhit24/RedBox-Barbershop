'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { listTransfers, type StockTransfer } from '@/lib/stockistApi';

export default function TransfersPage() {
  const { user } = useUser();
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTransfers().then(({ transfers }) => setTransfers(transfers)).catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-bold">Pengiriman</h2>
        {user?.role === 'owner' && (
          <Link href="/admin/stockist/transfers/new" className="text-sm px-3 py-1.5 rounded font-medium" style={{ background: '#C72820' }}>
            Buat Transfer
          </Link>
        )}
      </div>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
      <ul className="space-y-2">
        {transfers.map((t) => (
          <li key={t.id}>
            <Link href={`/admin/stockist/transfers/${t.id}`} className="block p-3 rounded border border-white/10 text-sm flex justify-between">
              <span>{t.transfer_number}</span>
              <span className="uppercase text-xs opacity-70">{t.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
