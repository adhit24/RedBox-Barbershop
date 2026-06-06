'use client';
import { useEffect, useState } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { fetchBarberStats, fetchBarberUpcoming, fetchBarberStreak, fetchBarberPace, fetchBarberXP, fetchBarberTitle, fetchBarberRival, fetchBarberKing } from '@/lib/barberApi';
import { BookingCard } from '@/components/BookingCard';
import { TargetProgressBar } from '@/components/barber/TargetProgressBar';
import { UpcomingBookingCard } from '@/components/barber/UpcomingBookingCard';
import { StreakBadge } from '@/components/barber/StreakBadge';
import { PaceCard } from '@/components/barber/PaceCard';
import { XPBar } from '@/components/barber/XPBar';
import { RivalWidget } from '@/components/barber/RivalWidget';
import { KingBadge } from '@/components/barber/KingBadge';
import type { BarberStats, BarberUpcoming, StreakData, PaceData, XPData, TitleData, RivalData, KingData } from '@/lib/barberTypes';

function rupiah(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(n);
}

function todayLabel() {
  return new Date().toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function tomorrowLabel() {
  const t = new Date(Date.now() + 24 * 3600 * 1000);
  return t.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function BarberHomePage() {
  const { data: session } = useBarberSession();
  const [stats, setStats] = useState<BarberStats | null>(null);
  const [upcoming, setUpcoming] = useState<BarberUpcoming | null>(null);
  const [loading, setLoading] = useState(true);
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [pace, setPace] = useState<PaceData | null>(null);
  const [xp, setXp] = useState<XPData | null>(null);
  const [title, setTitle] = useState<TitleData | null>(null);
  const [rival, setRival] = useState<RivalData | null>(null);
  const [king, setKing] = useState<KingData | null>(null);

  useEffect(() => {
    if (!session) return;
    Promise.all([
      fetchBarberStats('day'),
      fetchBarberUpcoming(),
      fetchBarberStreak(),
      fetchBarberPace(),
      fetchBarberXP(),
      fetchBarberTitle(),
      fetchBarberRival().catch(() => null),
      fetchBarberKing().catch(() => null),
    ])
      .then(([s, u, st, p, x, t, rv, k]) => {
        setStats(s); setUpcoming(u); setStreak(st); setPace(p);
        setXp(x); setTitle(t); setRival(rv); setKing(k);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session]);

  if (loading || !session || !stats || !upcoming) {
    return <div className="p-4 text-center text-gray-400">Memuat...</div>;
  }

  const target = session.profile?.target_daily ?? 10;
  const homeServiceToday = upcoming.today.filter(b => b.type === 'home_service');

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs text-gray-500">{todayLabel()}</p>
        <h2 className="text-xl font-bold text-gray-900">Halo, {session.barber.name.split(' ')[0]}</h2>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
        <TargetProgressBar
          current={stats.count}
          target={target}
          label="Target Hari Ini"
        />
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">{rupiah(stats.revenue)}</span>
          <span className="text-gray-500">{stats.hours}j</span>
        </div>
      </div>

      {streak && <StreakBadge streak={streak} />}

      {xp && title && (
        <div>
          <XPBar xp={xp} title={title} />
        </div>
      )}

      {king && (
        <div>
          <KingBadge data={king} />
        </div>
      )}

      {rival && (
        <div>
          <RivalWidget data={rival} />
        </div>
      )}

      {upcoming.next && <UpcomingBookingCard booking={upcoming.next} />}

      {homeServiceToday.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Home Service Hari Ini ({homeServiceToday.length})</p>
          {homeServiceToday.map(b => (
            <BookingCard key={b.id} booking={b} />
          ))}
        </div>
      )}

      {pace && <PaceCard pace={pace} />}

      {upcoming.tomorrow.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Besok — {tomorrowLabel()}</p>
          <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 space-y-2">
            {upcoming.tomorrow.slice(0, 5).map(b => (
              <div key={b.id} className="flex justify-between text-sm">
                <span className="text-gray-700">{b.time} — {b.customer_name}</span>
                <span className="text-gray-500">{b.service}</span>
              </div>
            ))}
            {upcoming.tomorrow.length > 5 && (
              <p className="text-xs text-gray-400">+{upcoming.tomorrow.length - 5} booking lainnya</p>
            )}
          </div>
        </div>
      )}

      {upcoming.today.length === 0 && upcoming.tomorrow.length === 0 && (
        <div className="text-center py-10 text-gray-400">
          <p>Belum ada jadwal hari ini atau besok</p>
        </div>
      )}
    </div>
  );
}
