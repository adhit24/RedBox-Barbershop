'use client';
import { useEffect, useState } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { fetchBarberStats, fetchBarberHistory } from '@/lib/barberApi';
import { StatsGrid } from '@/components/barber/StatsGrid';
import { BookingCard } from '@/components/BookingCard';
import type { BarberStats } from '@/lib/barberTypes';
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
