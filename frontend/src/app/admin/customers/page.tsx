'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchLoyalCustomers, fetchNewCustomers, fetchDormantCustomers } from '@/lib/adminCrmApi';
import type { CustomerRow } from '@/lib/adminCrmTypes';

type Tab = 'loyal' | 'new' | 'dormant';

const WA_TEMPLATES: Record<Tab, (name: string, branch: string) => string> = {
  loyal:   (_name, branch) => `Makasih udah setia ke RedBox ${branch}! Kapster favoritmu siap melayani 😊`,
  new:     (name, branch)  => `Halo ${name}, senang kamu coba RedBox ${branch}! Gimana pengalamannya? 😊`,
  dormant: (name, branch)  => `Halo ${name}, sudah lama nih! Yuk balik ke RedBox ${branch} 😊`,
};

function toWaNumber(wa: string) {
  let n = wa.replace(/\D/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  return n;
}

export default function CustomersPage() {
  const { user } = useUser();
  const branch = user?.branch || '';
  const [tab, setTab] = useState<Tab>('dormant');
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!branch) return;
    setLoading(true);
    const fetcher = tab === 'loyal' ? fetchLoyalCustomers :
                    tab === 'new'   ? fetchNewCustomers : fetchDormantCustomers;
    fetcher(branch)
      .then(r => setCustomers(r.customers))
      .catch(() => setCustomers([]))
      .finally(() => setLoading(false));
  }, [tab, branch]);

  function openWA(c: CustomerRow) {
    const num = toWaNumber(c.wa || '');
    if (!num) return;
    const branchLabel = branch.charAt(0).toUpperCase() + branch.slice(1);
    const msg = WA_TEMPLATES[tab](c.name, branchLabel);
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">👥 Customer</h2>

      <div className="flex gap-2">
        {([['loyal','🔥 Loyal'],['new','🆕 Baru'],['dormant','😴 Dormant']] as [Tab,string][]).map(([t,label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
              tab === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-center text-gray-400 py-8">Memuat...</p>
      ) : customers.length === 0 ? (
        <p className="text-center text-gray-400 py-8">Tidak ada data</p>
      ) : (
        <div className="space-y-2">
          {customers.map((c, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-800 text-sm">{c.name}</p>
                <p className="text-xs text-gray-400">{c.wa}</p>
                {tab === 'loyal' && c.count && (
                  <p className="text-xs text-gray-400">{c.count}x bulan ini</p>
                )}
                {tab === 'dormant' && c.date && (
                  <p className="text-xs text-gray-400">Terakhir: {c.date}</p>
                )}
                {tab === 'new' && c.date && (
                  <p className="text-xs text-gray-400">Pertama: {c.date}</p>
                )}
              </div>
              {c.wa && c.wa !== '-' && (
                <button onClick={() => openWA(c)}
                  className="ml-3 flex-shrink-0 bg-green-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">
                  WA
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
