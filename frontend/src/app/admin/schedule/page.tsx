'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchSchedule, blockBarberDate, unblockBarberDate } from '@/lib/adminCrmApi';
import { useSearchParams } from 'next/navigation';
import type { ScheduleData } from '@/lib/adminCrmTypes';
import { motion } from 'framer-motion';
import { CalendarDays, ChevronLeft, ChevronRight, Scissors } from 'lucide-react';

function mondayOfWeek(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() - ((day === 0 ? 7 : day) - 1));
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const DAY_LABELS = ['Sen','Sel','Rab','Kam','Jum','Sab','Min'];

function formatWeekRange(monday: string) {
  const start = new Date(monday + 'T00:00:00');
  const end = new Date(monday + 'T00:00:00');
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => `${d.getDate()} ${d.toLocaleString('id-ID', { month: 'short' })}`;
  return `${fmt(start)} – ${fmt(end)}`;
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

export default function SchedulePage() {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const readonly = searchParams.get('readonly') === 'true';
  const branch = user?.branch || '';
  const [week, setWeek] = useState(mondayOfWeek(todayStr()));
  const [data, setData] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = async () => {
    if (!branch) return;
    const d = await fetchSchedule(branch, week).catch(() => null);
    if (d) setData(d);
  };

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, week]);

  async function toggleBlock(barber_id: string, date: string, isBlocked: boolean) {
    const key = `${barber_id}-${date}`;
    setToggling(key);
    if (isBlocked) await unblockBarberDate(barber_id, date);
    else await blockBarberDate(barber_id, date);
    await load();
    setToggling(null);
  }

  function prevWeek() {
    const d = new Date(week + 'T00:00:00');
    d.setDate(d.getDate() - 7);
    setWeek(d.toISOString().slice(0, 10));
  }
  function nextWeek() {
    const d = new Date(week + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    setWeek(d.toISOString().slice(0, 10));
  }

  return (
    <div className="p-4 space-y-4 pb-6">

      {/* Header */}
      <div className="flex items-center gap-2">
        <CalendarDays size={16} className="text-slate-500" />
        <h2 className="text-white font-bold text-base">Jadwal Kapster</h2>
      </div>

      {/* Week Navigation */}
      <div className="flex items-center justify-between bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-2.5">
        <button
          onClick={prevWeek}
          className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition-all active:scale-95 cursor-pointer"
        >
          <ChevronLeft size={16} />
        </button>
        <p className="text-sm font-semibold text-slate-200">{formatWeekRange(week)}</p>
        <button
          onClick={nextWeek}
          className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition-all active:scale-95 cursor-pointer"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : !data ? (
        <p className="text-center text-slate-500 text-sm py-8">Gagal memuat</p>
      ) : (
        <div className="space-y-3">
          {data.barbers.map((barber, i) => (
            <motion.div
              key={barber.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07, duration: 0.25 }}
              className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3 space-y-2.5"
            >
              <div className="flex items-center gap-2">
                <Scissors size={13} className="text-slate-500" />
                <p className="font-semibold text-white text-sm">{barber.name}</p>
              </div>

              <div className="flex gap-1.5">
                {data.days.map((day, idx) => {
                  const isBlocked = data.overrides[barber.id]?.[day] === true;
                  const dayOfWeek = new Date(day + 'T00:00:00').getDay();
                  const workDayMap: Record<string, number> = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0 };
                  const isWorkDay = barber.work_days?.some((wd: string) => workDayMap[wd] === dayOfWeek) ?? true;
                  const key = `${barber.id}-${day}`;
                  const isToggling = toggling === key;

                  return (
                    <button
                      key={day}
                      onClick={() => !readonly && toggleBlock(barber.id, day, isBlocked)}
                      disabled={isToggling || readonly}
                      className={`flex-1 py-2 rounded-xl text-[11px] font-semibold transition-all disabled:opacity-60 ${readonly ? 'cursor-not-allowed' : 'active:scale-95 cursor-pointer'} ${
                        isBlocked
                          ? 'bg-red-500/15 text-red-400 border border-red-500/25'
                          : !isWorkDay
                          ? 'bg-slate-800/40 text-slate-600 border border-slate-800'
                          : 'bg-green-500/10 text-green-500 border border-green-500/20'
                      }`}
                    >
                      {DAY_LABELS[idx]}
                    </button>
                  );
                })}
              </div>

              {!readonly && <p className="text-[10px] text-slate-600">Tap untuk blokir / buka hari</p>}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
