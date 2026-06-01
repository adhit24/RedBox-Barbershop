'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { BookingCard } from '@/components/BookingCard';
import { fetchBookings } from '@/lib/api';
import { createClient } from '@/utils/supabase/client';
import { type Booking } from '@/lib/constants';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayLabel() {
  return new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export default function SchedulePage() {
  const { user } = useUser();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  async function load(barberId: string) {
    try {
      const data = await fetchBookings({ date: todayStr(), barber_id: barberId });
      setBookings(data.sort((a, b) => a.time.localeCompare(b.time)));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.barber_id) return;
    load(user.barber_id);

    // Supabase Realtime — auto-update when bookings change for this barber
    const supabase = createClient();
    const channel = supabase
      .channel('barber-schedule')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `barber_id=eq.${user.barber_id}`,
        },
        () => load(user.barber_id!)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.barber_id]);

  if (loading) {
    return <div className="p-4 text-center py-10 text-gray-400">Memuat jadwal...</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Jadwal Saya</h2>
        <p className="text-sm text-gray-500">{todayLabel()}</p>
      </div>

      {bookings.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">✂️</p>
          <p className="text-gray-500">Belum ada jadwal hari ini</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <BookingCard key={b.id} booking={b} />
          ))}
        </div>
      )}
    </div>
  );
}
