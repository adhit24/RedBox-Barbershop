'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { reassignBooking, createWalkIn } from '@/lib/adminCrmApi';

const STATUS_COLORS: Record<string, string> = {
  pending:     'bg-yellow-100 text-yellow-700',
  confirmed:   'bg-blue-100 text-blue-700',
  done:        'bg-green-100 text-green-700',
  cancelled:   'bg-red-100 text-red-700',
  no_show:     'bg-gray-100 text-gray-500',
  departed:    'bg-indigo-100 text-indigo-700',
  arrived:     'bg-cyan-100 text-cyan-700',
  in_progress: 'bg-purple-100 text-purple-700',
};

type BookingFilter = { date: string; status: string; type: string };

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function BookingControlPage() {
  const { user } = useUser();
  const branch = user?.branch || '';

  const [bookings, setBookings] = useState<any[]>([]);
  const [barbers, setBarbers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<BookingFilter>({ date: today(), status: 'all', type: 'all' });
  const [walkinOpen, setWalkinOpen] = useState(false);
  const [walkinData, setWalkinData] = useState({ name: '', wa: '', barber_id: '', service: '' });
  const [reassignModal, setReassignModal] = useState<{ bookingId: string } | null>(null);

  const load = useCallback(async () => {
    if (!branch) return;
    const params = new URLSearchParams({ location: branch, date: filter.date });
    if (filter.status !== 'all') params.set('status', filter.status);
    const [bkRes, brRes] = await Promise.all([
      fetch(`/api/bookings?${params}`).then(r => r.json()),
      fetch(`/api/barbers?branch=${branch}`).then(r => r.json()),
    ]);
    let bks = bkRes.bookings || bkRes || [];
    if (filter.type !== 'all') {
      if (filter.type === 'home_service') bks = bks.filter((b: any) => (b.notes || '').toUpperCase().includes('HOME SERVICE'));
      else if (filter.type === 'wedding') bks = bks.filter((b: any) => (b.notes || '').toUpperCase().includes('WEDDING'));
      else if (filter.type === 'walk_in') bks = bks.filter((b: any) => (b.notes || '').toUpperCase().includes('WALK-IN'));
      else bks = bks.filter((b: any) => !['HOME SERVICE','WEDDING','WALK-IN'].some(t => (b.notes || '').toUpperCase().includes(t)));
    }
    setBookings(bks.sort((a: any, b: any) => a.time.localeCompare(b.time)));
    setBarbers(brRes.barbers || brRes || []);
  }, [branch, filter]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function updateStatus(id: string, status: string) {
    await fetch('/api/admin/booking-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    load();
  }

  async function doReassign(barber_id: string) {
    if (!reassignModal) return;
    await reassignBooking(reassignModal.bookingId, barber_id);
    setReassignModal(null);
    load();
  }

  async function submitWalkIn() {
    if (!walkinData.barber_id || !walkinData.service) return;
    await createWalkIn({ ...walkinData, branch });
    setWalkinOpen(false);
    setWalkinData({ name: '', wa: '', barber_id: '', service: '' });
    load();
  }

  const isHomeService = (b: any) =>
    (b.notes || '').toUpperCase().includes('HOME SERVICE') ||
    (b.notes || '').toUpperCase().includes('WEDDING');

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">📋 Booking Control</h2>
        <button onClick={() => setWalkinOpen(true)}
          className="text-sm font-semibold bg-gray-900 text-white px-3 py-1.5 rounded-lg">
          + Walk-in
        </button>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <input type="date" value={filter.date}
          onChange={e => setFilter(f => ({ ...f, date: e.target.value }))}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {['all','pending','confirmed','done','cancelled','no_show'].map(s => (
            <button key={s} onClick={() => setFilter(f => ({ ...f, status: s }))}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                filter.status === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200'
              }`}>
              {s === 'all' ? 'Semua' : s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {['all','online','home_service','wedding','walk_in'].map(t => (
            <button key={t} onClick={() => setFilter(f => ({ ...f, type: t }))}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                filter.type === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200'
              }`}>
              {t === 'all' ? 'Semua' : t.replace('_',' ')}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-center text-gray-400">Memuat...</p>
      ) : bookings.length === 0 ? (
        <p className="text-center text-gray-400 py-8">Tidak ada booking</p>
      ) : (
        <div className="space-y-2">
          {bookings.map((bk: any) => (
            <div key={bk.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-800 text-sm">{bk.name}</p>
                  <p className="text-xs text-gray-400">{bk.time} · {bk.service}</p>
                  {bk.wa && bk.wa !== '-' && <p className="text-xs text-gray-400">{bk.wa}</p>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[bk.status] || 'bg-gray-100'}`}>
                    {bk.status}
                  </span>
                  {isHomeService(bk) && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">🏠</span>}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-1.5">
                {bk.status === 'pending' && <>
                  <button onClick={() => updateStatus(bk.id, 'confirmed')}
                    className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded-lg">Confirm</button>
                  <button onClick={() => updateStatus(bk.id, 'cancelled')}
                    className="px-3 py-1 text-xs font-medium bg-red-100 text-red-600 rounded-lg">Cancel</button>
                  <button onClick={() => setReassignModal({ bookingId: bk.id })}
                    className="px-3 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg">Reassign</button>
                </>}
                {bk.status === 'confirmed' && <>
                  <button onClick={() => updateStatus(bk.id, 'done')}
                    className="px-3 py-1 text-xs font-medium bg-green-600 text-white rounded-lg">Done</button>
                  <button onClick={() => updateStatus(bk.id, 'no_show')}
                    className="px-3 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg">No-show</button>
                  <button onClick={() => updateStatus(bk.id, 'cancelled')}
                    className="px-3 py-1 text-xs font-medium bg-red-100 text-red-600 rounded-lg">Cancel</button>
                  {isHomeService(bk) && (
                    <button onClick={() => updateStatus(bk.id, 'departed')}
                      className="px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded-lg">🔵 Berangkat</button>
                  )}
                </>}
                {bk.status === 'departed' && (
                  <button onClick={() => updateStatus(bk.id, 'arrived')}
                    className="px-3 py-1 text-xs font-medium bg-cyan-600 text-white rounded-lg">🟢 Sampai</button>
                )}
                {bk.status === 'arrived' && (
                  <button onClick={() => updateStatus(bk.id, 'in_progress')}
                    className="px-3 py-1 text-xs font-medium bg-purple-600 text-white rounded-lg">🔄 Dikerjakan</button>
                )}
                {bk.status === 'in_progress' && (
                  <button onClick={() => updateStatus(bk.id, 'done')}
                    className="px-3 py-1 text-xs font-medium bg-green-600 text-white rounded-lg">✅ Selesai</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Walk-in Modal */}
      {walkinOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50">
          <div className="bg-white rounded-t-2xl w-full p-4 space-y-3">
            <p className="font-bold text-gray-900">+ Walk-in Customer</p>
            <input placeholder="Nama (opsional)" value={walkinData.name}
              onChange={e => setWalkinData(d => ({ ...d, name: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            <input placeholder="No HP (opsional)" value={walkinData.wa}
              onChange={e => setWalkinData(d => ({ ...d, wa: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            <select value={walkinData.barber_id}
              onChange={e => setWalkinData(d => ({ ...d, barber_id: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
              <option value="">Pilih Kapster</option>
              {barbers.filter((b: any) => b.branch === branch).map((b: any) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <input placeholder="Service (misal: Potong Rambut)" value={walkinData.service}
              onChange={e => setWalkinData(d => ({ ...d, service: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button onClick={() => setWalkinOpen(false)}
                className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-600">Batal</button>
              <button onClick={submitWalkIn}
                className="flex-1 py-2 bg-gray-900 text-white rounded-xl text-sm font-semibold">Catat</button>
            </div>
          </div>
        </div>
      )}

      {/* Reassign Modal */}
      {reassignModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50">
          <div className="bg-white rounded-t-2xl w-full p-4 space-y-2 max-h-96 overflow-y-auto">
            <p className="font-bold text-gray-900 mb-3">Pilih Kapster Pengganti</p>
            {barbers.filter((b: any) => b.branch === branch && b.is_active).map((b: any) => (
              <button key={b.id} onClick={() => doReassign(b.id)}
                className="w-full text-left px-4 py-3 bg-gray-50 rounded-xl text-sm font-medium text-gray-700">
                {b.name}
              </button>
            ))}
            <button onClick={() => setReassignModal(null)}
              className="w-full py-2 border border-gray-200 rounded-xl text-sm text-gray-500 mt-2">Batal</button>
          </div>
        </div>
      )}
    </div>
  );
}
