'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { fetchLoyalCustomers, fetchNewCustomers, fetchDormantCustomers } from '@/lib/adminCrmApi';
import type { CustomerRow } from '@/lib/adminCrmTypes';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Flame, Sparkles, Moon, MessageCircle, Phone } from 'lucide-react';

type Tab = 'loyal' | 'new' | 'dormant';

const TABS: { key: Tab; label: string; Icon: React.ElementType; color: string }[] = [
  { key: 'loyal',   label: 'Loyal',   Icon: Flame,    color: 'text-orange-400' },
  { key: 'new',     label: 'Baru',    Icon: Sparkles, color: 'text-blue-400' },
  { key: 'dormant', label: 'Dormant', Icon: Moon,     color: 'text-slate-400' },
];

const WA_TEMPLATES: Record<Tab, (name: string, branch: string) => string> = {
  loyal:   (_name, branch) => `Makasih udah setia ke RedBox ${branch}! Kapster favoritmu siap melayani`,
  new:     (name, branch)  => `Halo ${name}, senang kamu coba RedBox ${branch}! Gimana pengalamannya?`,
  dormant: (name, branch)  => `Halo ${name}, sudah lama nih! Yuk balik ke RedBox ${branch}`,
};

function toWaNumber(wa: string) {
  let n = wa.replace(/\D/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  return n;
}

function Skeleton({ className }: { className?: string }) {
  return (
    <motion.div
      animate={{ opacity: [0.4, 0.7, 0.4] }}
      transition={{ duration: 1.4, repeat: Infinity }}
      className={`bg-slate-800 rounded-lg ${className}`}
    />
  );
}

export default function CustomersPage() {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const branch = searchParams.get('branch') || user?.branch || '';
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

  const activeTab = TABS.find(t => t.key === tab)!;

  return (
    <div className="p-4 space-y-4 pb-6">

      {/* Header */}
      <div className="flex items-center gap-2">
        <Users size={16} className="text-slate-500" />
        <h2 className="text-white font-bold text-base">Customer</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-900 p-1 rounded-2xl">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              tab === key
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-300'
            }`}>
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="space-y-2"
        >
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)
          ) : customers.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <activeTab.Icon size={28} className={`mx-auto ${activeTab.color} opacity-40`} />
              <p className="text-slate-500 text-sm">Tidak ada data</p>
            </div>
          ) : (
            customers.map((c, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, duration: 0.2 }}
                className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3 flex items-center justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-white text-sm truncate">{c.name}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    {c.wa && c.wa !== '-' && <Phone size={10} className="text-slate-500" />}
                    <p className="text-[11px] text-slate-500">{c.wa}</p>
                  </div>
                  {tab === 'loyal' && c.count && (
                    <p className="text-[11px] text-orange-400 mt-0.5">{c.count}x bulan ini</p>
                  )}
                  {tab === 'dormant' && c.date && (
                    <p className="text-[11px] text-slate-500 mt-0.5">Terakhir: {c.date}</p>
                  )}
                  {tab === 'new' && c.date && (
                    <p className="text-[11px] text-blue-400 mt-0.5">Pertama: {c.date}</p>
                  )}
                </div>
                {c.wa && c.wa !== '-' && (
                  <button
                    onClick={() => openWA(c)}
                    className="ml-3 flex-shrink-0 flex items-center gap-1.5 bg-green-500/15 text-green-400 border border-green-500/30 text-xs font-semibold px-3 py-1.5 rounded-xl hover:bg-green-500/25 active:scale-95 transition-all cursor-pointer"
                  >
                    <MessageCircle size={12} />
                    WA
                  </button>
                )}
              </motion.div>
            ))
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
