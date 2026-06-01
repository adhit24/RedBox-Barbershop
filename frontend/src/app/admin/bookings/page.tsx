'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { BranchFilter } from '@/components/BranchFilter';
import { BookingCard } from '@/components/BookingCard';
import { fetchBookings } from '@/lib/api';
import { BOOKING_STATUSES, type BranchKey, type Booking, type BookingStatus } from '@/lib/constants';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function BookingsPage() {
  const { user } = useUser();
  const [branch, setBranch] = useState<BranchKey>('all');
  const [date, setDate] = useState(todayStr());
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'all'>('all');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchBookings({
        date,
        location: branch,
        status: statusFilter !== 'all' ? statusFilter : undefined,
      });
      setBookings(data.sort((a, b) => a.time.localeCompare(b.time)));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [branch, date, statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleStatusChange(id: string, status: string) {
    try {
      await fetch('/api/admin/booking-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: id, status }),
      });
      load();
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">Booking</h2>

      {user?.role === 'owner' && (
        <BranchFilter value={branch} onChange={setBranch} />
      )}

      <div className="flex gap-2 items-center">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as BookingStatus | 'all')}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
        >
          <option value="all">Semua Status</option>
          {BOOKING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-400">Memuat...</div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-10 text-gray-400">Tidak ada booking</div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              onStatusChange={handleStatusChange}
              showBranch={branch === 'all'}
            />
          ))}
        </div>
      )}
    </div>
  );
}
