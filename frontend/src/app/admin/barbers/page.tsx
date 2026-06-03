'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchAttendance, updateAttendance, fetchAttendanceHistory } from '@/lib/adminCrmApi';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import type { AttendanceData } from '@/lib/adminCrmTypes';
import { motion, AnimatePresence } from 'framer-motion';
import { UserCheck, History, Scissors } from 'lucide-react';

const STATUSES = ['hadir','terlambat','izin','sakit','cuti'] as const;
type AttStatus = typeof STATUSES[number];

const STATUS_META: Record<AttStatus, { color: string; dot: string }> = {
  hadir:     { color: 'bg-green-500/15 text-green-400 border-green-500/30',   dot: 'bg-green-400' },
  terlambat: { color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',   dot: 'bg-amber-400' },
  izin:      { color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',      dot: 'bg-blue-400' },
  sakit:     { color: 'bg-red-500/15 text-red-400 border-red-500/30',         dot: 'bg-red-400' },
  cuti:      { color: 'bg-slate-500/15 text-slate-400 border-slate-500/30',   dot: 'bg-slate-400' },
};

const BTN_ACTIVE: Record<AttStatus, string> = {
  hadir:     'bg-green-500/20 text-green-400 border-green-500/40',
  terlambat: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
  izin:      'bg-blue-500/20 text-blue-400 border-blue-500/40',
  sakit:     'bg-red-500/20 text-red-400 border-red-500/40',
  cuti:      'bg-slate-600/40 text-slate-300 border-slate-500/40',
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function Skeleton({ className }: { className?: string }) {
  return (
    <motion.div
      animate={{ opacity: [0.4, 0.7, 0.4] }}
      transition={{ duration: 1.4, repeat: Infinity }}
      className={`bg-slate-800 rounded-lg ${className}`}
    />
  );
}

function StatusPill({ status }: { status: AttStatus | string }) {
  const m = STATUS_META[status as AttStatus] ?? { color: 'bg-slate-500/15 text-slate-400 border-slate-500/30', dot: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border capitalize ${m.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {status}
    </span>
  );
}

function AttendancePageInner() {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const readonly = searchParams.get('readonly') === 'true';
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
    <div className="p-4 space-y-4 pb-6">

      {/* Header */}
      <div className="flex items-center gap-2">
        <UserCheck size={16} className="text-slate-500" />
        <h2 className="text-white font-bold text-base">Absensi Kapster</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-900 p-1 rounded-2xl">
        {([['today','Hari Ini'],['history','Riwayat']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              tab === t
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-300'
            }`}>
            {label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === 'today' && (
          <motion.div key="today" initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }} className="space-y-2">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)
            ) : !data ? (
              <p className="text-center text-slate-500 text-sm py-8">Gagal memuat</p>
            ) : (
              data.barbers.map((b, i) => (
                <motion.div
                  key={b.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.25 }}
                  className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Scissors size={13} className="text-slate-500" />
                      <div>
                        <p className="font-semibold text-white text-sm">{b.name}</p>
                        <p className="text-[11px] text-slate-500">{b.today_count} customer hari ini</p>
                      </div>
                    </div>
                    {b.attendance
                      ? <StatusPill status={b.attendance.status} />
                      : <span className="text-[11px] text-slate-500 border border-slate-700 rounded-full px-2 py-0.5">Belum</span>
                    }
                  </div>

                  <div className="flex gap-1.5 flex-wrap">
                    {STATUSES.map(s => {
                      const isActive = b.attendance?.status === s;
                      return (
                        <button
                          key={s}
                          disabled={updating === b.id || readonly}
                          onClick={() => !readonly && setStatus(b.id, s)}
                          className={`px-2.5 py-1 text-[11px] rounded-lg border font-medium transition-all capitalize active:scale-95 ${
                            isActive
                              ? BTN_ACTIVE[s]
                              : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:bg-slate-700'
                          } disabled:opacity-40 ${readonly ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              ))
            )}
          </motion.div>
        )}

        {tab === 'history' && (
          <motion.div key="history" initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }} className="space-y-3">
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="w-full bg-[#0F172A] border border-slate-700 rounded-2xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-slate-500 [color-scheme:dark]"
            />
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)
            ) : !history ? (
              <p className="text-center text-slate-500 text-sm py-8">Gagal memuat</p>
            ) : (
              history.barbers.map((b: any, i: number) => {
                const recs = history.records.filter((r: any) => r.barber_id === b.id);
                const counts: Record<string, number> = {};
                for (const r of recs) counts[r.status] = (counts[r.status] || 0) + 1;
                return (
                  <motion.div
                    key={b.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3 space-y-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <History size={13} className="text-slate-500" />
                      <p className="font-semibold text-white text-sm">{b.name}</p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {Object.entries(counts).length === 0
                        ? <p className="text-xs text-slate-500">Tidak ada data</p>
                        : Object.entries(counts).map(([s, c]) => (
                            <span key={s} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border capitalize ${
                              STATUS_META[s as AttStatus]?.color ?? 'bg-slate-500/15 text-slate-400 border-slate-500/30'
                            }`}>
                              {s}: {c}
                            </span>
                          ))
                      }
                    </div>
                  </motion.div>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AttendancePage() {
  return <Suspense><AttendancePageInner /></Suspense>;
}
