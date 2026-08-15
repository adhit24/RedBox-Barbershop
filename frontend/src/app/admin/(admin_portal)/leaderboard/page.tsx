'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { fetchAdminLeaderboard } from '@/lib/adminCrmApi';
import type { LeaderboardItem } from '@/lib/adminCrmTypes';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Users, Flame, Home } from 'lucide-react';

type Category = 'customer' | 'streak' | 'home_service';

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
  const [items, setItems] = useState<LeaderboardItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!branch) return;
    setLoading(true);
    fetchAdminLeaderboard(branch, category)
      .then(r => setItems(r.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [branch, category]);

  return (
    <div className="p-4 space-y-4 pb-6">

      {/* Header */}
      <div className="flex items-center gap-2">
        <Trophy size={16} className="text-slate-500" />
        <h2 className="text-white font-bold text-base">Leaderboard Cabang</h2>
      </div>

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
