'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchCommandCenter } from '@/lib/adminCrmApi';
import type { CommandCenterData } from '@/lib/adminCrmTypes';

const STATUS_COLORS: Record<string, string> = {
  pending:     'bg-yellow-100 text-yellow-700',
  confirmed:   'bg-blue-100 text-blue-700',
  done:        'bg-green-100 text-green-700',
  cancelled:   'bg-red-100 text-red-700',
  no_show:     'bg-gray-100 text-gray-600',
  departed:    'bg-indigo-100 text-indigo-700',
  arrived:     'bg-cyan-100 text-cyan-700',
  in_progress: 'bg-purple-100 text-purple-700',
};

const HS_NEXT: Record<string, string> = {
  confirmed:   'departed',
  departed:    'arrived',
  arrived:     'in_progress',
  in_progress: 'done',
};

const HS_LABEL: Record<string, string> = {
  confirmed:   '🔵 Tandai Berangkat',
  departed:    '🟢 Tandai Sampai',
  arrived:     '🔄 Mulai Kerjakan',
  in_progress: '✅ Selesai',
};

export default function CommandCenterPage() {
  const { user } = useUser();
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);

  const branch = user?.branch || '';

  const load = useCallback(async () => {
    if (!branch) return;
    const d = await fetchCommandCenter(branch).catch(() => null);
    if (d) setData(d);
  }, [branch]);

  useEffect(() => {
    load().finally(() => setLoading(false));
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  async function advanceHsStatus(bookingId: string, nextStatus: string) {
    await fetch('/api/admin/booking-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bookingId, status: nextStatus }),
    });
    load();
  }

  async function quickAction(bookingId: string, status: string) {
    await fetch('/api/admin/booking-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bookingId, status }),
    });
    load();
  }

  if (loading) return <div className="p-4 text-center text-gray-400">Memuat...</div>;
  if (!data) return <div className="p-4 text-center text-red-400">Gagal memuat data</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900 capitalize">📊 {branch}</h2>
        <p className="text-xs text-gray-400">{data.today}</p>
      </div>

      {/* Smart Alerts */}
      {data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((alert, i) => (
            <div key={i} className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 flex gap-2 items-start">
              <span className="text-amber-500 text-sm mt-0.5">⚠️</span>
              <p className="text-sm text-amber-800">{alert.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Hadir',       value: data.stats.hadir,               color: 'text-green-600' },
          { label: 'Tdk Hadir',   value: data.stats.tidak_hadir,         color: 'text-red-500' },
          { label: 'Blm Check-in',value: data.stats.belum_check_in,      color: 'text-yellow-600' },
          { label: 'Booking',     value: data.stats.booking_today,       color: 'text-blue-600' },
          { label: 'Pending',     value: data.stats.pending,             color: 'text-orange-500' },
          { label: 'Home Svc',    value: data.stats.home_service_active, color: 'text-purple-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-3 text-center">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Home Service Tracker */}
      {data.home_service.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">🏠 Home Service Aktif</p>
          {data.home_service.map(hs => {
            const next = HS_NEXT[hs.status];
            return (
              <div key={hs.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{hs.name}</p>
                    <p className="text-xs text-gray-400">{hs.time} · {hs.service}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[hs.status] || 'bg-gray-100'}`}>
                    {hs.status}
                  </span>
                </div>
                {next && (
                  <button
                    onClick={() => advanceHsStatus(hs.id, next)}
                    className="w-full py-1.5 text-sm font-medium bg-gray-900 text-white rounded-lg"
                  >
                    {HS_LABEL[hs.status]}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Booking Feed */}
      {data.booking_feed.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">📋 Booking Masuk</p>
          {data.booking_feed.map(bk => (
            <div key={bk.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-semibold text-gray-800 text-sm">{bk.name}</p>
                  <p className="text-xs text-gray-400">{bk.time} · {bk.service}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[bk.status] || 'bg-gray-100'}`}>
                  {bk.status}
                </span>
              </div>
              {bk.status === 'pending' && (
                <div className="flex gap-2">
                  <button onClick={() => quickAction(bk.id, 'confirmed')}
                    className="flex-1 py-1 text-xs font-medium bg-blue-600 text-white rounded-lg">
                    Confirm
                  </button>
                  <button onClick={() => quickAction(bk.id, 'cancelled')}
                    className="flex-1 py-1 text-xs font-medium bg-red-100 text-red-600 rounded-lg">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Kapster On-Duty */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">💈 Kapster Hari Ini</p>
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {data.barbers.map(b => (
            <div key={b.id} className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  {b.attendance_status === 'hadir' || b.attendance_status === 'terlambat' ? '🟢' :
                   b.attendance_status ? '🔴' : '⚪'}
                </span>
                <p className="text-sm font-medium text-gray-700">{b.name}</p>
              </div>
              <div className="flex items-center gap-2">
                {b.attendance_status && (
                  <span className="text-[11px] text-gray-400 capitalize">{b.attendance_status}</span>
                )}
                <span className="text-sm font-bold text-gray-600">{b.today_count}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
