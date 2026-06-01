'use client';
import { useEffect, useState } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { BookingCard } from '@/components/BookingCard';
import { fetchBookings } from '@/lib/api';
import { createClient } from '@/utils/supabase/client';
import { type Booking } from '@/lib/constants';

type Tab = 'today' | 'tomorrow' | 'week';

function dateForTab(tab: Tab): { from: string; to: string; label: string } {
  const now = new Date();
  function fmt(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  if (tab === 'today') {
    return { from: fmt(now), to: fmt(now), label: 'Hari Ini' };
  }
  if (tab === 'tomorrow') {
    const t = new Date(now.getTime() + 24*3600*1000);
    return { from: fmt(t), to: fmt(t), label: 'Besok' };
  }
  const end = new Date(now.getTime() + 6*24*3600*1000);
  return { from: fmt(now), to: fmt(end), label: '7 Hari ke Depan' };
}

export default function SchedulePage() {
  const { data: session } = useBarberSession();
  const [tab, setTab] = useState<Tab>('today');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  async function load(barberId: string, currentTab: Tab) {
    setLoading(true);
    const { from, to } = dateForTab(currentTab);
    try {
      if (from === to) {
        const data = await fetchBookings({ date: from, barber_id: barberId });
        setBookings(data.sort((a, b) => a.time.localeCompare(b.time)));
      } else {
        const days: string[] = [];
        let d = new Date(from);
        const endD = new Date(to);
        while (d <= endD) {
          days.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
          d = new Date(d.getTime() + 24*3600*1000);
        }
        const all = await Promise.all(
          days.map(date => fetchBookings({ date, barber_id: barberId }).catch(() => []))
        );
        const flat = all.flat();
        flat.sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          return a.time.localeCompare(b.time);
        });
        setBookings(flat);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const barberId = session?.barber.id;
    if (!barberId) return;
    load(barberId, tab);

    const supabase = createClient();
    const channel = supabase
      .channel('barber-schedule')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `barber_id=eq.${barberId}` },
        () => load(barberId, tab)
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session?.barber.id, tab]);

  const groupedByDate = bookings.reduce<Record<string, Booking[]>>((acc, b) => {
    acc[b.date] = acc[b.date] || [];
    acc[b.date].push(b);
    return acc;
  }, {});

  function dateLabel(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">Jadwal Saya</h2>

      <div className="flex gap-2">
        {(['today', 'tomorrow', 'week'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              tab === t ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {dateForTab(t).label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-400">Memuat...</div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">✂️</p>
          <p className="text-gray-500">Belum ada jadwal</p>
        </div>
      ) : tab === 'week' ? (
        <div className="space-y-4">
          {Object.entries(groupedByDate).map(([date, items]) => (
            <div key={date} className="space-y-2">
              <p className="text-sm font-medium text-gray-700">{dateLabel(date)}</p>
              {items.map(b => <BookingCard key={b.id} booking={b} />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map(b => <BookingCard key={b.id} booking={b} />)}
        </div>
      )}
    </div>
  );
}
