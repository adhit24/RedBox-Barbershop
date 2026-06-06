'use client';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, X, Check, UserX, Calendar, Clock } from 'lucide-react';
import { StatusBadge } from './bookingStatus';
import { createClient } from '@/utils/supabase/client';

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
  const startPad = firstDay.getDay();
  const days: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) days.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

// ─── Action Sheet ──────────────────────────────────────────────────────────────

const BTN: Record<string, string> = {
  green:  'bg-green-500/15 text-green-400 border-green-500/30',
  red:    'bg-red-500/15 text-red-400 border-red-500/30',
  slate:  'bg-slate-700/60 text-slate-300 border-slate-600',
  indigo: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  cyan:   'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  purple: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
};

interface ActionSheetProps {
  booking: BookingRow;
  barbers: { id: string; name: string }[];
  loading: boolean;
  onStatus: (id: string, status: string) => void;
  onReschedule: (id: string, date: string, time: string) => void;
  onClose: () => void;
}

function ActionSheet({ booking, barbers, loading, onStatus, onReschedule, onClose }: ActionSheetProps) {
  const [showReschedule, setShowReschedule] = useState(false);
  const [rDate, setRDate] = useState(booking.date);
  const [rTime, setRTime] = useState(booking.time.slice(0, 5));
  const isHS = (booking.notes || '').toUpperCase().includes('HOME SERVICE') ||
               (booking.notes || '').toUpperCase().includes('WEDDING');
  const barberName = barbers.find(b => b.id === booking.barber_id)?.name;
  const canReschedule = ['pending', 'confirmed'].includes(booking.status);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 z-50 flex items-end backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }}
        transition={{ type: 'spring', stiffness: 420, damping: 36 }}
        className="w-full rounded-t-2xl p-5 space-y-4"
        style={{ background: '#0F172A', borderTop: '1px solid rgba(255,255,255,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="font-bold text-white text-sm">{booking.name || '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">{booking.time.slice(0,5)} · {booking.service}</p>
            {barberName && <p className="text-xs text-slate-500 mt-0.5">{barberName}</p>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusBadge status={booking.status} />
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer p-1">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Status Actions */}
        {!showReschedule && (
          <div className="flex flex-wrap gap-2">
            {booking.status === 'pending' && <>
              <Btn color="green" label="Konfirmasi" icon={<Check size={12}/>} loading={loading} onClick={() => onStatus(booking.id, 'confirmed')} />
              <Btn color="red"   label="Batalkan"   icon={<X size={12}/>}     loading={loading} onClick={() => onStatus(booking.id, 'cancelled')} />
            </>}
            {booking.status === 'confirmed' && <>
              <Btn color="green" label="Done"     icon={<Check size={12}/>}  loading={loading} onClick={() => onStatus(booking.id, 'done')} />
              <Btn color="slate" label="No-show"  icon={<UserX size={12}/>} loading={loading} onClick={() => onStatus(booking.id, 'no_show')} />
              <Btn color="red"   label="Batalkan" icon={<X size={12}/>}      loading={loading} onClick={() => onStatus(booking.id, 'cancelled')} />
              {isHS && <Btn color="indigo" label="Berangkat" icon={<ChevronRight size={12}/>} loading={loading} onClick={() => onStatus(booking.id, 'departed')} />}
            </>}
            {booking.status === 'departed'    && <Btn color="cyan"   label="Sampai"     icon={<ChevronRight size={12}/>} loading={loading} onClick={() => onStatus(booking.id, 'arrived')} />}
            {booking.status === 'arrived'     && <Btn color="purple" label="Dikerjakan" icon={<ChevronRight size={12}/>} loading={loading} onClick={() => onStatus(booking.id, 'in_progress')} />}
            {booking.status === 'in_progress' && <Btn color="green"  label="Selesai"    icon={<Check size={12}/>}        loading={loading} onClick={() => onStatus(booking.id, 'done')} />}
            {canReschedule && (
              <Btn color="slate" label="Reschedule" icon={<Calendar size={12}/>} loading={false} onClick={() => setShowReschedule(true)} />
            )}
          </div>
        )}

        {/* Reschedule Form */}
        {showReschedule && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Ubah Jadwal</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500 uppercase tracking-wide flex items-center gap-1">
                  <Calendar size={10}/> Tanggal
                </label>
                <input
                  type="date" value={rDate} onChange={e => setRDate(e.target.value)}
                  className="w-full h-10 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm text-slate-200 focus:outline-none focus:border-slate-500 [color-scheme:dark]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500 uppercase tracking-wide flex items-center gap-1">
                  <Clock size={10}/> Jam
                </label>
                <input
                  type="time" value={rTime} onChange={e => setRTime(e.target.value)}
                  className="w-full h-10 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm text-slate-200 focus:outline-none focus:border-slate-500 [color-scheme:dark]"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowReschedule(false)}
                className="flex-1 h-10 border border-slate-700 rounded-xl text-sm text-slate-400 cursor-pointer active:scale-95 transition-all"
              >
                Batal
              </button>
              <button
                onClick={() => onReschedule(booking.id, rDate, rTime)}
                disabled={loading || !rDate}
                className="flex-1 h-10 rounded-xl text-sm font-semibold text-white cursor-pointer active:scale-95 transition-all disabled:opacity-50"
                style={{ background: '#C72820' }}
              >
                {loading ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function Btn({ color, label, icon, loading, onClick }: {
  color: string; label: string; icon: React.ReactNode; loading: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick} disabled={loading}
      className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-medium border cursor-pointer active:scale-95 transition-all disabled:opacity-50 ${BTN[color]}`}
    >
      {icon}{label}
    </button>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function CalendarView({ branch, barbers, readonly }: CalendarViewProps) {
  const today = todayStr();
  const todayDate = new Date();

  const [year, setYear]                 = useState(todayDate.getFullYear());
  const [month, setMonth]               = useState(todayDate.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(today);
  const [barberFilter, setBarberFilter] = useState('all');
  const [loadingDate, setLoadingDate]   = useState<string | null>(null);
  const [dayCache, setDayCache]         = useState<Map<string, BookingRow[]>>(new Map());
  const [actionBooking, setActionBooking] = useState<BookingRow | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const detailRef                       = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!branch) return;
    setDayCache(new Map());
    setSelectedDate(todayStr());
    loadDay(todayStr());
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
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      const bookings: BookingRow[] = Array.isArray(data?.bookings)
        ? data.bookings
        : Array.isArray(data) ? data : [];
      setDayCache(prev => new Map(prev).set(dateStr, bookings.sort((a, b) => a.time.localeCompare(b.time))));
    } catch {
      // Do not cache errors — allow retry on next click
    } finally {
      setLoadingDate(null);
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }
  }

  function invalidateAndReload(dateStr: string) {
    setDayCache(prev => { const m = new Map(prev); m.delete(dateStr); return m; });
    loadDay(dateStr);
  }

  async function handleStatus(id: string, status: string) {
    setActionLoading(true);
    try {
      await fetch('/api/admin/booking-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      setActionBooking(null);
      if (selectedDate) invalidateAndReload(selectedDate);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReschedule(id: string, newDate: string, newTime: string) {
    setActionLoading(true);
    try {
      const supabase = createClient();
      const updates: Record<string, string> = { date: newDate };
      if (newTime) updates.time = newTime + ':00';
      await supabase.from('bookings').update(updates).eq('id', id);
      setActionBooking(null);
      // Invalidate both old and new date
      if (selectedDate) invalidateAndReload(selectedDate);
      if (newDate !== selectedDate) {
        setDayCache(prev => { const m = new Map(prev); m.delete(newDate); return m; });
      }
    } finally {
      setActionLoading(false);
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
          <button onClick={prevMonth} className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition-all active:scale-95 cursor-pointer">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-slate-200 min-w-[110px] text-center">
            {MONTHS_ID[month]} {year}
          </span>
          <button onClick={nextMonth} className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition-all active:scale-95 cursor-pointer">
            <ChevronRight size={16} />
          </button>
        </div>

        <select
          value={barberFilter}
          onChange={e => setBarberFilter(e.target.value)}
          className="h-8 rounded-xl px-3 text-xs font-medium focus:outline-none cursor-pointer [color-scheme:dark]"
          style={{ background: '#0F0A0D', border: '1px solid rgba(255,255,255,0.08)', color: barberFilter === 'all' ? '#6B5A5E' : '#F0EAEB' }}
        >
          <option value="all">Semua Kapster</option>
          {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {/* Calendar grid */}
      <div className="bg-[#0F172A] border border-slate-800 rounded-2xl overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-800">
          {DAY_HEADERS.map(d => (
            <div key={d} className="py-2 text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, idx) => {
            if (!day) return <div key={`pad-${idx}`} className="aspect-square" />;
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
                <span className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold transition-all ${
                  isToday ? 'bg-[#C72820] text-white' : isSelected ? 'border border-white/50 text-white' : 'text-slate-400 hover:text-white'
                }`}>
                  {day.getDate()}
                </span>
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
            <p className="text-sm font-semibold text-white">{formatDetailTitle(selectedDate)}</p>

            {loadingDate === selectedDate ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <motion.div key={i} animate={{ opacity: [0.4, 0.7, 0.4] }}
                    transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15 }}
                    className="h-14 bg-slate-800 rounded-xl" />
                ))}
              </div>
            ) : !filteredBookings || filteredBookings.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">Tidak ada booking</p>
            ) : (
              <div className="space-y-2">
                {filteredBookings.map(bk => {
                  const barberName = barbers.find(b => b.id === bk.barber_id)?.name;
                  return (
                    <motion.button
                      key={bk.id}
                      onClick={() => !readonly && setActionBooking(bk)}
                      whileTap={!readonly ? { scale: 0.98 } : {}}
                      className={`w-full flex items-start justify-between gap-2 bg-slate-800/50 rounded-xl px-3 py-2.5 text-left transition-colors ${
                        !readonly ? 'hover:bg-slate-700/60 cursor-pointer active:scale-[0.98]' : 'cursor-default'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-white text-sm truncate">{bk.name || '—'}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{bk.time.slice(0,5)} · {bk.service}</p>
                        {barberName && <p className="text-xs text-slate-600 mt-0.5">{barberName}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                        <StatusBadge status={bk.status} />
                        {!readonly && <ChevronRight size={12} className="text-slate-600" />}
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action Bottom Sheet */}
      <AnimatePresence>
        {actionBooking && (
          <ActionSheet
            booking={actionBooking}
            barbers={barbers}
            loading={actionLoading}
            onStatus={handleStatus}
            onReschedule={handleReschedule}
            onClose={() => setActionBooking(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
