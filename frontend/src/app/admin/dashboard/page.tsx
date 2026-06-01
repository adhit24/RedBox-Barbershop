'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { BranchFilter } from '@/components/BranchFilter';
import { fetchBookings, fetchBarbers, fetchRevenue } from '@/lib/api';
import { type BranchKey, type Booking, type Barber } from '@/lib/constants';

function rupiah(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DashboardPage() {
  const { user } = useUser();
  const [branch, setBranch] = useState<BranchKey>('all');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [revenue, setRevenue] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bks, brs, rev] = await Promise.all([
        fetchBookings({ date: todayStr(), location: branch }),
        fetchBarbers(true),
        fetchRevenue('month', branch),
      ]);
      setBookings(bks);
      setBarbers(brs.filter((b) => branch === 'all' || b.branch === branch));
      setRevenue(rev.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [branch]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60s
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const done    = bookings.filter((b) => b.status === 'done').length;
  const pending = bookings.filter((b) => b.status === 'pending' || b.status === 'confirmed').length;
  const activeBarbers   = barbers.filter((b) => b.is_active && !b.today_override).length;
  const inactiveBarbers = barbers.filter((b) => !b.is_active || b.today_override).length;

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">Dashboard</h2>

      {user?.role === 'owner' && (
        <BranchFilter value={branch} onChange={setBranch} />
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-400">Memuat data...</div>
      ) : (
        <>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500 mb-3">📋 Booking Hari Ini</p>
            <p className="text-3xl font-bold text-gray-900">{bookings.length}</p>
            <div className="flex gap-4 mt-3">
              <div>
                <p className="text-2xl font-semibold text-green-600">{done}</p>
                <p className="text-xs text-gray-500">Selesai</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-yellow-600">{pending}</p>
                <p className="text-xs text-gray-500">Proses</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-red-500">
                  {bookings.filter((b) => b.status === 'cancelled').length}
                </p>
                <p className="text-xs text-gray-500">Batal</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500 mb-3">💈 Status Barber</p>
            <div className="flex gap-4">
              <div>
                <p className="text-2xl font-semibold text-green-600">{activeBarbers}</p>
                <p className="text-xs text-gray-500">Aktif</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-red-500">{inactiveBarbers}</p>
                <p className="text-xs text-gray-500">Tidak Aktif</p>
              </div>
            </div>
            {inactiveBarbers > 0 && (
              <div className="mt-3 space-y-1">
                {barbers
                  .filter((b) => !b.is_active || b.today_override)
                  .map((b) => (
                    <p key={b.id} className="text-sm text-red-500">
                      🔴 {b.name}{' '}
                      <span className="text-gray-400 text-xs capitalize">({b.branch})</span>
                    </p>
                  ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500 mb-1">💰 Estimasi Revenue (30 hari)</p>
            <p className="text-2xl font-bold text-gray-900">{rupiah(revenue)}</p>
            <p className="text-xs text-gray-400 mt-1">
              Dari {bookings.filter((b) => b.status === 'done').length} booking selesai hari ini
            </p>
          </div>
        </>
      )}
    </div>
  );
}
