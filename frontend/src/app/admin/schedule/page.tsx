'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchSchedule, blockBarberDate, unblockBarberDate } from '@/lib/adminCrmApi';
import type { ScheduleData } from '@/lib/adminCrmTypes';

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

export default function SchedulePage() {
  const { user } = useUser();
  const branch = user?.branch || '';
  const [week, setWeek] = useState(mondayOfWeek(todayStr()));
  const [data, setData] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);

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
    if (isBlocked) await unblockBarberDate(barber_id, date);
    else await blockBarberDate(barber_id, date);
    load();
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
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">📅 Jadwal Kapster</h2>

      {/* Week navigation */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-2">
        <button onClick={prevWeek} className="text-gray-500 font-bold px-2">‹</button>
        <p className="text-sm font-semibold text-gray-700">{week}</p>
        <button onClick={nextWeek} className="text-gray-500 font-bold px-2">›</button>
      </div>

      {loading ? (
        <p className="text-center text-gray-400">Memuat...</p>
      ) : !data ? (
        <p className="text-center text-gray-400">Gagal memuat</p>
      ) : (
        <div className="space-y-3">
          {data.barbers.map(barber => (
            <div key={barber.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
              <p className="font-semibold text-gray-800 text-sm mb-2">{barber.name}</p>
              <div className="flex gap-1.5">
                {data.days.map((day, i) => {
                  const isBlocked = data.overrides[barber.id]?.[day] === true;
                  const dayOfWeek = new Date(day + 'T00:00:00').getDay();
                  const workDayMap: Record<string, number> = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0 };
                  const isWorkDay = barber.work_days?.some((wd: string) => workDayMap[wd] === dayOfWeek) ?? true;
                  return (
                    <button
                      key={day}
                      onClick={() => toggleBlock(barber.id, day, isBlocked)}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                        isBlocked   ? 'bg-red-100 text-red-600' :
                        !isWorkDay  ? 'bg-gray-50 text-gray-300' :
                                      'bg-green-50 text-green-700'
                      }`}
                    >
                      {DAY_LABELS[i]}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Tap untuk blokir/buka hari</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
