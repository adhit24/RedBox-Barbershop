'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { fetchAdminLeaderboard, syncAdminLeaderboardMoka } from '@/lib/adminCrmApi';
import type { LeaderboardItem } from '@/lib/adminCrmTypes';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Users, Flame, Home, RefreshCw } from 'lucide-react';

type Category = 'customer' | 'streak' | 'home_service';
type PeriodRange = { type: string; start: string; end: string };

const CATS: { key: Category; label: string; Icon: React.ElementType }[] = [
  { key: 'customer',     label: 'Customer',    Icon: Users },
  { key: 'streak',       label: 'Streak',      Icon: Flame },
  { key: 'home_service', label: 'Home Svc',    Icon: Home },
];

const RANK_STYLE: Record<number, { bg: string; text: string; label: string }> = {
  1: { bg: 'bg-amber-500/15 border-amber-500/30',  text: 'text-amber-400',  label: '#1' },
  2: { bg: 'bg-slate-500/15 border-slate-500/30',  text: 'text-slate-300',  label: '#2' },
  3: { bg: 'bg-orange-500/10 border-orange-500/25',text: 'text-orange-400', label: '#3' },
};

function Skeleton({ className }: { className?: string }) {
  return (
    <motion.div
      animate={{ opacity: [0.4, 0.7, 0.4] }}
      transition={{ duration: 1.4, repeat: Infinity }}
      className={`bg-slate-800 rounded-lg ${className}`}
    />
  );
}

export default function AdminLeaderboardPage() {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const branch = searchParams.get('branch') || user?.branch || '';
  const [category, setCategory] = useState<Category>('customer');
  const [period, setPeriod] = useState<'week' | 'month'>('month');
  const [items, setItems] = useState<LeaderboardItem[]>([]);
  const [periodRange, setPeriodRange] = useState<PeriodRange | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  useEffect(() => {
    if (!branch) return;
    fetchAdminLeaderboard(branch, category, period)
      .then(r => {
        setItems(r.items);
        setPeriodRange(r.period);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [branch, category, period]);

  async function handleSyncMoka() {
    setSyncing(true);
    setSyncMessage('');
    try {
      const result = await syncAdminLeaderboardMoka(branch);
      setSyncMessage(`Sync selesai · ${result.transactions} transaksi · ${result.services} layanan`);
      const refreshed = await fetchAdminLeaderboard(branch, category, period);
      setItems(refreshed.items);
      setPeriodRange(refreshed.period);
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : 'Sync Moka gagal');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="p-4 space-y-4 pb-6">

      {/* Header */}
      <div className="flex items-center gap-2">
        <Trophy size={16} className="text-slate-500" />
        <div className="min-w-0 flex-1">
          <h2 className="text-white font-bold text-base">Leaderboard Cabang</h2>
          <p className="text-[10px] text-slate-500">Performa kapster berdasarkan pelanggan dilayani</p>
        </div>
        <button type="button" onClick={() => void handleSyncMoka()} disabled={syncing}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-2 text-[10px] font-semibold text-slate-300 transition hover:border-teal-500 hover:text-white disabled:opacity-50"
          title="Sync transaksi Moka terbaru">
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Sync…' : 'Sync Moka'}
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Periode ranking</span>
        <div className="flex gap-1 rounded-lg bg-slate-900 p-1">
          {(['week', 'month'] as const).map(key => (
            <button key={key} type="button" onClick={() => setPeriod(key)}
              className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition ${period === key ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
              {key === 'week' ? 'Minggu ini' : 'Bulan ini'}
            </button>
          ))}
        </div>
      </div>
      {periodRange && (
        <p className="text-[11px] text-slate-500">
          Data periode: <span className="font-semibold text-slate-300">
            {new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(`${periodRange.start}T12:00:00+07:00`))}
            {' — '}
            {new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(`${periodRange.end}T12:00:00+07:00`))}
          </span>
        </p>
      )}
      {syncMessage && <p className="text-[10px] text-slate-500" role="status">{syncMessage}</p>}

      {/* Category Tabs */}
      <div className="flex gap-2 bg-slate-900 p-1 rounded-2xl">
        {CATS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setCategory(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              category === key
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
          key={category}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="space-y-2"
        >
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)
          ) : items.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <Trophy size={28} className="mx-auto text-slate-600" />
              <p className="text-slate-500 text-sm">Belum ada data</p>
            </div>
          ) : (
            items.map((item, i) => {
              const rs = RANK_STYLE[item.rank];
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.25 }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${
                    rs ? `${rs.bg}` : 'bg-[#0F172A] border-slate-800'
                  }`}
                >
                  {/* Rank */}
                  <div className="w-8 flex-shrink-0 text-center">
                    {rs ? (
                      <span className={`text-sm font-bold ${rs.text}`}>{rs.label}</span>
                    ) : (
                      <span className="text-xs text-slate-500">#{item.rank}</span>
                    )}
                  </div>

                  {/* Name */}
                  <p className={`flex-1 font-semibold text-sm ${rs ? rs.text : 'text-slate-200'}`}>
                    {item.name}
                  </p>

                  {/* Score */}
                  <span className={`text-sm font-bold tabular-nums ${rs ? rs.text : 'text-slate-400'}`}>
                    {item.display}
                  </span>
                </motion.div>
              );
            })
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
