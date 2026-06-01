'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { BranchFilter } from '@/components/BranchFilter';
import { fetchBarbers } from '@/lib/api';
import { type BranchKey, type Barber } from '@/lib/constants';

export default function BarbersPage() {
  const { user } = useUser();
  const [branch, setBranch] = useState<BranchKey>('all');
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchBarbers(true);
      setBarbers(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = barbers.filter((b) => branch === 'all' || b.branch === branch);

  async function toggleActive(barber: Barber) {
    try {
      await fetch(`/api/admin/barber-toggle/${barber.id}`, { method: 'POST' });
      load();
    } catch (e) {
      console.error(e);
    }
  }

  async function toggleOverride(barber: Barber) {
    try {
      await fetch(`/api/admin/barber-override/${barber.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override: !barber.today_override }),
      });
      load();
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">Barber</h2>

      {user?.role === 'owner' && (
        <BranchFilter value={branch} onChange={setBranch} />
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-400">Memuat...</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((barber) => {
            const isOff = !barber.is_active || !!barber.today_override;
            return (
              <div
                key={barber.id}
                className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-semibold text-gray-900">{barber.name}</p>
                    <p className="text-sm text-gray-500 capitalize">{barber.branch}</p>
                  </div>
                  <span
                    className={`text-sm font-medium ${
                      isOff ? 'text-red-500' : 'text-green-600'
                    }`}
                  >
                    {isOff ? '🔴 Nonaktif' : '🟢 Aktif'}
                  </span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => toggleActive(barber)}
                    className="flex-1 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {barber.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                  <button
                    onClick={() => toggleOverride(barber)}
                    className={`flex-1 py-1.5 text-sm rounded-lg transition-colors ${
                      barber.today_override
                        ? 'bg-orange-50 text-orange-700 border border-orange-200'
                        : 'border border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {barber.today_override ? 'Batal Libur' : 'Libur Hari Ini'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
