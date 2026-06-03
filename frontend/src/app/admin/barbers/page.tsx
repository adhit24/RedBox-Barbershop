'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchAttendance, updateAttendance, fetchAttendanceHistory } from '@/lib/adminCrmApi';
import type { AttendanceData } from '@/lib/adminCrmTypes';

const STATUSES = ['hadir','terlambat','izin','sakit','cuti'] as const;
type AttStatus = typeof STATUSES[number];

const STATUS_COLOR: Record<AttStatus, string> = {
  hadir:     'bg-green-100 text-green-700',
  terlambat: 'bg-yellow-100 text-yellow-700',
  izin:      'bg-blue-100 text-blue-700',
  sakit:     'bg-red-100 text-red-700',
  cuti:      'bg-gray-100 text-gray-600',
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function AttendancePage() {
  const { user } = useUser();
  const branch = user?.branch || '';
  const [tab, setTab] = useState<'today'|'history'>('today');
  const [data, setData] = useState<AttendanceData | null>(null);
  const [history, setHistory] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [month, setMonth] = useState(todayStr().slice(0, 7));

  const loadToday = useCallback(async () => {
    if (!branch) return;
    const d = await fetchAttendance(branch).catch(() => null);
    if (d) setData(d);
  }, [branch]);

  const loadHistory = useCallback(async () => {
    if (!branch) return;
    const d = await fetchAttendanceHistory(branch, month).catch(() => null);
    if (d) setHistory(d);
  }, [branch, month]);

  useEffect(() => {
    setLoading(true);
    if (tab === 'today') loadToday().finally(() => setLoading(false));
    else loadHistory().finally(() => setLoading(false));
  }, [tab, loadToday, loadHistory]);

  async function setStatus(barber_id: string, status: AttStatus) {
    setUpdating(barber_id);
    await updateAttendance(barber_id, todayStr(), status).catch(() => null);
    await loadToday();
    setUpdating(null);
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">💈 Absensi Kapster</h2>

      <div className="flex gap-2">
        {(['today','history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${
              tab === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200'
            }`}>
            {t === 'today' ? 'Hari Ini' : 'Riwayat'}
          </button>
        ))}
      </div>

      {tab === 'today' && (
        <>
          {loading ? <p className="text-center text-gray-400">Memuat...</p> :
           !data ? <p className="text-center text-gray-400">Gagal memuat</p> : (
            <div className="space-y-2">
              {data.barbers.map(b => (
                <div key={b.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-800">{b.name}</p>
                      <p className="text-xs text-gray-400">{b.today_count} customer hari ini</p>
                    </div>
                    {b.attendance ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLOR[b.attendance.status as AttStatus]}`}>
                        {b.attendance.status}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Belum check-in</span>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {STATUSES.map(s => (
                      <button key={s} disabled={updating === b.id}
                        onClick={() => setStatus(b.id, s)}
                        className={`px-2.5 py-1 text-xs rounded-lg border font-medium transition-all ${
                          b.attendance?.status === s
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white text-gray-500 border-gray-200'
                        }`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          <input type="month" value={month}
            onChange={e => setMonth(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          {loading ? <p className="text-center text-gray-400">Memuat...</p> :
           !history ? <p className="text-center text-gray-400">Gagal memuat</p> : (
            <div className="space-y-2">
              {history.barbers.map((b: any) => {
                const recs = history.records.filter((r: any) => r.barber_id === b.id);
                const counts: Record<string, number> = {};
                for (const r of recs) counts[r.status] = (counts[r.status] || 0) + 1;
                return (
                  <div key={b.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
                    <p className="font-semibold text-gray-800 mb-2">{b.name}</p>
                    <div className="flex gap-3 flex-wrap">
                      {Object.entries(counts).map(([s, c]) => (
                        <span key={s} className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLOR[s as AttStatus] || 'bg-gray-100 text-gray-600'}`}>
                          {s}: {c}
                        </span>
                      ))}
                      {recs.length === 0 && <p className="text-xs text-gray-400">Tidak ada data</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
