'use client';
import { useEffect, useState } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { fetchBarberStats, fetchBarberHistory, fetchBarberStreak, fetchBarberAchievements, fetchBarberRecords, fetchBarberMissions, fetchBarberLeaderboard, fetchBarberFavorites, fetchBarberReviews } from '@/lib/barberApi';
import { StatsGrid } from '@/components/barber/StatsGrid';
import { BookingCard } from '@/components/BookingCard';
import { StreakBadge } from '@/components/barber/StreakBadge';
import { BadgeGrid } from '@/components/barber/BadgeGrid';
import { MissionList } from '@/components/barber/MissionList';
import { TierIndicator } from '@/components/barber/TierIndicator';
import { FavoriteCustomerList } from '@/components/barber/FavoriteCustomerList';
import { ReviewQuoteCard } from '@/components/barber/ReviewQuoteCard';
import Link from 'next/link';
import type { BarberStats, StreakData, AchievementsResponse, RecordsData, MissionsResponse, LeaderboardData } from '@/lib/barberTypes';
import type { Booking } from '@/lib/constants';

type Period = 'day' | 'week' | 'month' | 'year';

const PERIOD_LABELS: Record<Period, string> = {
  day: 'Hari Ini',
  week: '7 Hari',
  month: '30 Hari',
  year: '1 Tahun',
};

export default function BarberProgressPage() {
  const { data: session } = useBarberSession();
  const [period, setPeriod] = useState<Period>('month');
  const [stats, setStats] = useState<BarberStats | null>(null);
  const [history, setHistory] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [achievements, setAchievements] = useState<AchievementsResponse | null>(null);
  const [records, setRecords] = useState<RecordsData | null>(null);
  const [missions, setMissions] = useState<MissionsResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);
  const [favorites, setFavorites] = useState<Array<{name:string;visits:number;service:string}>>([]);
  const [reviews, setReviews] = useState<Array<{rating:number;review_text:string;customer_name:string;created_at:string}>>([]);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    Promise.all([fetchBarberStats(period), fetchBarberHistory(period)])
      .then(([s, h]) => {
        setStats(s);
        setHistory(h.items);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session, period]);

  useEffect(() => {
    if (!session) return;
    Promise.all([
      fetchBarberStreak(),
      fetchBarberAchievements(),
      fetchBarberRecords(),
      fetchBarberMissions(),
      fetchBarberLeaderboard(),
      fetchBarberFavorites(),
      fetchBarberReviews(),
    ])
      .then(([st, ach, rec, mis, lb, fav, rev]) => {
        setStreak(st);
        setAchievements(ach);
        setRecords(rec);
        setMissions(mis);
        setLeaderboard(lb);
        setFavorites(fav.favorites || []);
        setReviews(rev.reviews || []);
      })
      .catch(console.error);
  }, [session]);

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">📊 Progress Saya</h2>

      <div className="flex gap-2 overflow-x-auto">
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${
              period === p ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {loading || !stats ? (
        <div className="text-center py-10 text-gray-400">Memuat...</div>
      ) : (
        <>
          <StatsGrid stats={stats} />

          {/* Motivation Section */}
          {leaderboard && (
            <>
              <TierIndicator data={leaderboard} />
              <Link href="/barber/leaderboard" className="block text-center text-sm text-red-600 hover:underline -mt-2">
                Lihat detail leaderboard →
              </Link>
            </>
          )}
          {streak && <StreakBadge streak={streak} />}
          {missions && <MissionList data={missions} />}
          {achievements && <BadgeGrid data={achievements} />}

          {/* Records */}
          {records && records.best_customer_per_day > 0 && (
            <div className="bg-white rounded-xl p-4 border border-gray-100">
              <p className="text-sm font-medium text-gray-700 mb-2">🏆 Rekor Pribadi</p>
              <div className="space-y-1 text-sm">
                <p>📋 Customer/hari terbanyak: <span className="font-semibold">{records.best_customer_per_day}</span> ({records.best_customer_per_day_at})</p>
                {records.best_revenue_per_month > 0 && (
                  <p>💰 Revenue/bulan tertinggi: <span className="font-semibold">Rp {records.best_revenue_per_month.toLocaleString('id-ID')}</span></p>
                )}
              </div>
            </div>
          )}

          <FavoriteCustomerList favorites={favorites} />
          <ReviewQuoteCard reviews={reviews} />

          <div className="space-y-2 pt-4">
            <p className="text-sm font-medium text-gray-700">
              📜 History Customer ({history.length})
            </p>
            {history.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                Belum ada history untuk periode ini
              </div>
            ) : (
              <div className="space-y-3">
                {history.map(b => <BookingCard key={b.id} booking={b} />)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
