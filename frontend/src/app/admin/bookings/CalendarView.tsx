'use client';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { StatusBadge } from './bookingStatus';

interface CalendarViewProps {
  branch: string;
  barbers: { id: string; name: string }[];
  readonly?: boolean;
}

interface BookingRow {
  id: string;
  name: string;
  wa: string;
  service: string;
  barber_id: string | null;
  time: string;
  date: string;
  status: string;
  notes: string | null;
  location: string;
}

const MONTHS_ID = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember',
];
const DAY_NAMES_LONG = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const DAY_HEADERS = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr(): string {
  return toDateStr(new Date());
}

function getMonthDays(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay(); // 0=Sun
  const days: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) days.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

export function CalendarView({ branch, barbers }: CalendarViewProps) {
  const today = todayStr();
  const todayDate = new Date();

  const [year, setYear]               = useState(todayDate.getFullYear());
  const [month, setMonth]             = useState(todayDate.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(today);
  const [barberFilter, setBarberFilter] = useState('all');
  const [loadingDate, setLoadingDate] = useState<string | null>(null);
  const [dayCache, setDayCache]       = useState<Map<string, BookingRow[]>>(new Map());
  const detailRef                     = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!branch) return;
    loadDay(today);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);

  async function loadDay(dateStr: string) {
    setSelectedDate(dateStr);
    if (dayCache.has(dateStr)) {
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
      return;
    }
    setLoadingDate(dateStr);
    try {
      const params = new URLSearchParams({ location: branch, date: dateStr });
      const res  = await fetch(`/api/bookings?${params}`);
      const data = await res.json();
      const bookings: BookingRow[] = Array.isArray(data?.bookings)
        ? data.bookings
        : Array.isArray(data) ? data : [];
      setDayCache(prev => new Map(prev).set(dateStr, bookings.sort((a, b) => a.time.localeCompare(b.time))));
    } catch {
      setDayCache(prev => new Map(prev).set(dateStr, []));
    } finally {
      setLoadingDate(null);
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDate(null);
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDate(null);
  }

  const days = getMonthDays(year, month);

  const selectedBookings = selectedDate ? (dayCache.get(selectedDate) ?? null) : null;
  const filteredBookings = selectedBookings === null
    ? null
    : barberFilter === 'all'
      ? selectedBookings
      : selectedBookings.filter(b => b.barber_id === barberFilter);

  function formatDetailTitle(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return `${DAY_NAMES_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
  }

  return (
    <div className="space-y-3">

      {/* Sub-header: month nav + barber filter */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            onClick={prevMonth}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition-all active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-slate-200 min-w-[110px] text-center">
            {MONTHS_ID[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition-all active:scale-95 cursor-pointer"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <select
          value={barberFilter}
          onChange={e => setBarberFilter(e.target.value)}
          className="h-8 rounded-xl px-3 text-xs font-medium focus:outline-none cursor-pointer [color-scheme:dark]"
          style={{
            background: '#0F0A0D',
            border: '1px solid rgba(255,255,255,0.08)',
            color: barberFilter === 'all' ? '#6B5A5E' : '#F0EAEB',
          }}
        >
          <option value="all">Semua Kapster</option>
          {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {/* Calendar grid */}
      <div className="bg-[#0F172A] border border-slate-800 rounded-2xl overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-slate-800">
          {DAY_HEADERS.map(d => (
            <div key={d} className="py-2 text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {days.map((day, idx) => {
            if (!day) {
              return <div key={`pad-${idx}`} className="aspect-square" />;
            }
            const dateStr    = toDateStr(day);
            const isToday    = dateStr === today;
            const isSelected = dateStr === selectedDate && !isToday;
            const cached     = dayCache.get(dateStr);
            const hasBookings = cached && cached.length > 0;

            return (
              <button
                key={dateStr}
                onClick={() => loadDay(dateStr)}
                className="aspect-square flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 cursor-pointer"
              >
                <span
                  className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold transition-all ${
                    isToday
                      ? 'bg-[#C72820] text-white'
                      : isSelected
                      ? 'border border-white/50 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {day.getDate()}
                </span>
                {/* Dot indicator — only for cached days with bookings */}
                <span className={`w-1 h-1 rounded-full transition-all ${hasBookings && !isToday ? 'bg-[#C72820]' : 'bg-transparent'}`} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Day detail panel */}
      <AnimatePresence mode="wait">
        {selectedDate && (
          <motion.div
            ref={detailRef}
            key={selectedDate}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 space-y-3"
          >
            <p className="text-sm font-semibold text-white">
              {formatDetailTitle(selectedDate)}
            </p>

            {loadingDate === selectedDate ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <motion.div
                    key={i}
                    animate={{ opacity: [0.4, 0.7, 0.4] }}
                    transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15 }}
                    className="h-14 bg-slate-800 rounded-xl"
                  />
                ))}
              </div>
            ) : !filteredBookings || filteredBookings.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">Tidak ada booking</p>
            ) : (
              <div className="space-y-2">
                {filteredBookings.map(bk => {
                  const barberName = barbers.find(b => b.id === bk.barber_id)?.name;
                  return (
                    <div
                      key={bk.id}
                      className="flex items-start justify-between gap-2 bg-slate-800/50 rounded-xl px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-white text-sm truncate">{bk.name || '—'}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{bk.time} · {bk.service}</p>
                        {barberName && (
                          <p className="text-xs text-slate-600 mt-0.5">{barberName}</p>
                        )}
                      </div>
                      <StatusBadge status={bk.status} />
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
