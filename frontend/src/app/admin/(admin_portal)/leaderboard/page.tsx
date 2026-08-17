'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { fetchAdminLeaderboard, syncAdminLeaderboard } from '@/lib/adminCrmApi';
import type { LeaderboardItem } from '@/lib/adminCrmTypes';
import { LeaderboardCard } from '@/components/ui/leaderboard-card';
import { Trophy, Users, Flame, Home, RefreshCw } from 'lucide-react';

type Category = 'customer' | 'streak' | 'home_service';

const CATS = [
  { key: 'customer',     label: 'Customer Count', Icon: Users },
  { key: 'streak',       label: 'Attendance Streak', Icon: Flame },
  { key: 'home_service', label: 'Home Service Bookings', Icon: Home },
];

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-shimmer rounded-2xl ${className}`} />
  );
}

export default function AdminLeaderboardPage() {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const branch = searchParams.get('branch') || user?.branch || '';
  const [category, setCategory] = useState<Category>('customer');
  const [items, setItems] = useState<LeaderboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');

  const loadLeaderboard = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    try {
      const result = await fetchAdminLeaderboard(branch, category);
      setItems(result.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [branch, category]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadLeaderboard(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLeaderboard]);

  const handleRefresh = async () => {
    if (!branch || refreshing) return;
    setRefreshing(true);
    setRefreshError('');
    try {
      await syncAdminLeaderboard(branch);
      await loadLeaderboard();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : 'Sinkronisasi Moka gagal');
    } finally {
      setRefreshing(false);
    }
  };

  const runOptions = CATS.map(c => ({
    id: c.key,
    label: c.label
  }));

  const podiumRankings = items
    .filter(item => item.rank <= 3)
    .map(item => ({
      userId: item.id,
      userName: item.name,
      rank: item.rank,
      value: item.score
    }));

  const rankings = items.map(item => ({
    userId: item.id,
    rank: item.rank,
    userName: item.name,
    byline: item.branch ? `Cabang ${item.branch}` : undefined,
    value: item.score,
    displayed: true
  }));

  const today = new Date();
  // Get date range (current week or current day)
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay() + 1); // Monday

  if (loading) {
    return (
      <div className="p-4 space-y-5 pb-6">
        {/* Header Skeleton */}
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-slate-600 animate-pulse" />
          <Skeleton className="h-5 w-40" />
        </div>

        {/* Card Wrapper Skeleton */}
        <div 
          className="border rounded-2xl p-5 space-y-6"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.01) 100%)',
            borderColor: 'rgba(255,255,255,0.05)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}
        >
          {/* Header section skeleton */}
          <div className="flex justify-between items-start gap-4">
            <div className="space-y-2">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-8 w-32" />
          </div>

          {/* Podium section skeleton */}
          <div className="flex items-end justify-center gap-4 h-40 pt-4">
            <Skeleton className="h-28 w-20" />
            <Skeleton className="h-36 w-20" />
            <Skeleton className="h-20 w-20" />
          </div>

          {/* List items skeleton */}
          <div className="space-y-2.5 pt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Trophy size={16} className="text-[#C72820]" />
        <h2 className="text-white font-bold text-base">Ranking & Kinerja</h2>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || !branch}
          aria-label="Refresh data Ranking dan Kinerja dari Moka"
          title={refreshError || 'Tarik data terbaru dari Moka'}
          className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.10] text-slate-300 transition hover:border-white/[0.22] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        </button>
        {refreshError && <span className="max-w-[220px] truncate text-[10px] text-red-300">Gagal refresh</span>}
      </div>

      {items.length === 0 ? (
        <div 
          className="border rounded-2xl py-16 text-center space-y-3"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.015) 100%)',
            borderColor: 'rgba(255,255,255,0.06)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <Trophy size={36} className="mx-auto text-slate-600" />
          <div className="space-y-1">
            <p className="text-slate-300 font-semibold text-sm">Belum Ada Data Kinerja</p>
            <p className="text-slate-500 text-xs">Pilih kategori lain atau tunggu update sinkronisasi kasir.</p>
          </div>
          <div className="flex justify-center pt-2">
            <select
              aria-label="Select leaderboard category"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="bg-[#1A1215] text-white rounded-xl border border-white/[0.08] px-3 py-1.5 text-xs font-semibold cursor-pointer outline-none"
            >
              {runOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <LeaderboardCard
          title="Leaderboard Cabang"
          fromDate={startOfWeek}
          toDate={today}
          podiumRankings={podiumRankings}
          rankings={rankings}
          currentUserId={user?.id}
          runOptions={runOptions}
          selectedRunId={category}
          onRunChange={(val) => setCategory(val as Category)}
        />
      )}
    </div>
  );
}
