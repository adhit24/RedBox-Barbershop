'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Award, Crown, Flame, RefreshCw, Sparkles, Trophy, Users, Zap } from 'lucide-react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { fetchBarberLeaderboard, fetchLeaderboardCategory, refreshBarberLeaderboard } from '@/lib/barberApi';
import { TierIndicator } from '@/components/barber/TierIndicator';
import { LeaderboardCard } from '@/components/ui/leaderboard-card';
import { ProgressiveFluxLoader } from '@/components/ui/progressive-flux-loader';
import type { LeaderboardData, LeaderboardCategoryItem } from '@/lib/barberTypes';

type Category = 'live' | 'customer_champion' | 'streak_champion';

const CATEGORIES: { key: Category; label: string; description: string; icon: typeof Zap }[] = [
  { key: 'live', label: 'Live', description: 'Performa bulan ini', icon: Zap },
  { key: 'customer_champion', label: 'Customer', description: 'Paling banyak melayani', icon: Users },
  { key: 'streak_champion', label: 'Streak', description: 'Konsistensi terbaik', icon: Flame },
];

function dateLabel(month: string) {
  const parsed = new Date(`${month}-01T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? 'Bulan ini' : parsed.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

export default function LeaderboardPage() {
  const { data: session } = useBarberSession();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [category, setCategory] = useState<Category>('live');
  const [categoryItems, setCategoryItems] = useState<LeaderboardCategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(8);
  const [loadError, setLoadError] = useState('');
  const requestRef = useRef(0);

  const loadLeaderboard = useCallback(async (syncMoka = false) => {
    if (!session) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const isCurrentRequest = () => requestRef.current === requestId;
    setLoading(true);
    setLoadError('');
    setProgress(12);

    try {
      if (syncMoka) {
        setProgress(30);
        await refreshBarberLeaderboard();
      }
      const liveData = await fetchBarberLeaderboard();
      if (!isCurrentRequest()) return;
      setData(liveData);
      setProgress(category === 'live' ? 82 : 52);

      if (category === 'live') {
        setCategoryItems([]);
      } else {
        const result = await fetchLeaderboardCategory(category);
        if (!isCurrentRequest()) return;
        setCategoryItems(result.items);
        setProgress(82);
      }

      setProgress(100);
      await new Promise(resolve => window.setTimeout(resolve, 360));
    } catch (error) {
      if (!isCurrentRequest()) return;
      console.error(error);
      setLoadError('Data leaderboard belum bisa dimuat. Coba refresh lagi.');
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [category, session]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadLeaderboard(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLeaderboard]);

  const activeCategory = CATEGORIES.find(item => item.key === category) ?? CATEGORIES[0];
  const categoryItemsByRank = useMemo(() => categoryItems.slice().sort((a, b) => a.rank - b.rank), [categoryItems]);

  const livePodium = (data?.rankings ?? []).slice(0, 3).map(entry => ({
    userId: entry.barber_id,
    userName: entry.name,
    rank: entry.rank,
    value: entry.total_count,
    valueLabel: `${entry.total_count} cust`,
  }));

  const liveRankings = (data?.rankings ?? []).map(entry => ({
    userId: entry.barber_id,
    rank: entry.rank,
    userName: entry.name,
    byline: `${entry.branch} · Performa bulan ini`,
    value: entry.total_count,
    valueLabel: `${entry.total_count} customer`,
    displayed: true,
  }));

  const categoryPodium = categoryItemsByRank.slice(0, 3).map(item => ({
    userId: item.barber_id,
    userName: item.barber_name,
    rank: item.rank,
    value: item.score,
    valueLabel: item.display_value,
  }));

  const categoryRankings = categoryItemsByRank.map(item => ({
    userId: item.barber_id,
    rank: item.rank,
    userName: item.barber_name,
    byline: `${item.branch} · ${activeCategory.description}`,
    value: item.score,
    valueLabel: item.display_value,
    displayed: true,
  }));

  const podiumRankings = category === 'live' ? livePodium : categoryPodium;
  const rankings = category === 'live' ? liveRankings : categoryRankings;
  const currentUserId = session?.barber?.id;
  const isEmpty = !loading && data && rankings.length === 0;

  return (
    <div className="relative min-h-[calc(100vh-70px)] overflow-hidden px-4 pb-24 pt-5 text-white sm:px-6">
      <div className="pointer-events-none absolute -right-28 -top-24 h-72 w-72 rounded-full bg-[#C72820]/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-28 h-72 w-72 rounded-full bg-orange-500/[0.06] blur-3xl" />

      <div className="relative mx-auto max-w-2xl space-y-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[#E87068]">
              <Trophy size={16} />
              <span className="text-[10px] font-black uppercase tracking-[0.22em]">Arena Performa</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-[#F8F1F1]">Leaderboard</h2>
            <p className="mt-1 text-xs font-medium text-slate-500">Buktikan konsistensimu, satu customer setiap hari.</p>
          </div>
          <button
            type="button"
            onClick={() => { void loadLeaderboard(true); }}
            disabled={loading}
            aria-label="Refresh leaderboard"
            title="Refresh leaderboard"
            className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/[0.10] bg-white/[0.04] text-slate-300 transition hover:border-[#C72820]/60 hover:bg-[#C72820]/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </header>

        {(loading || progress > 0 && progress < 100) && (
          <ProgressiveFluxLoader value={progress} className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3" />
        )}

        {loadError && !loading && (
          <div className="rounded-2xl border border-red-400/20 bg-red-400/[0.08] px-4 py-3 text-xs font-semibold text-red-200">
            {loadError}
          </div>
        )}

        {data && (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Posisi</p>
              <p className="mt-1 text-lg font-black text-[#F4C58B]">#{data.rankings.find(entry => entry.is_me)?.rank ?? '-'}</p>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Customer</p>
              <p className="mt-1 text-lg font-black text-white">{data.my_count}</p>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Kompetitor</p>
              <p className="mt-1 text-lg font-black text-white">{data.barber_count}</p>
            </div>
          </div>
        )}

        {data && <TierIndicator data={data} />}

        <div role="tablist" aria-label="Kategori leaderboard" className="grid grid-cols-3 gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-1.5">
          {CATEGORIES.map(item => {
            const Icon = item.icon;
            const selected = category === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setCategory(item.key)}
                className={`relative flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-xl px-2 text-[10px] font-bold transition-all ${selected ? 'bg-[#C72820] text-white shadow-[0_8px_20px_rgba(199,40,32,.24)]' : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200'}`}
              >
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {data && data.next_tier_needed > 0 && category === 'live' && (
          <div className="flex items-center gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] px-4 py-3">
            <Sparkles size={17} className="shrink-0 text-amber-300" />
            <p className="text-xs font-semibold text-amber-100">Tinggal <strong>{data.next_tier_needed} customer</strong> lagi untuk naik tier.</p>
          </div>
        )}

        {isEmpty ? (
          <div className="rounded-3xl border border-white/[0.07] bg-white/[0.025] px-5 py-14 text-center">
            <Award size={32} className="mx-auto text-slate-600" />
            <p className="mt-3 text-sm font-bold text-slate-300">Belum ada data kategori ini</p>
            <p className="mt-1 text-xs text-slate-500">Data akan muncul setelah sinkronisasi leaderboard berjalan.</p>
          </div>
        ) : data ? (
          <LeaderboardCard
            title={activeCategory.key === 'live' ? 'Live Performance' : `${activeCategory.label} Champion`}
            fromDate={data.month ? `${data.month}-01` : new Date()}
            toDate={new Date()}
            podiumRankings={podiumRankings}
            rankings={rankings}
            currentUserId={currentUserId}
          />
        ) : null}

        <div className="flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          {category === 'live' ? <Crown size={13} /> : <Flame size={13} />}
          <span>{activeCategory.description}</span>
          <span>·</span>
          <span>{data ? dateLabel(data.month) : 'Bulan ini'}</span>
        </div>
      </div>
    </div>
  );
}
