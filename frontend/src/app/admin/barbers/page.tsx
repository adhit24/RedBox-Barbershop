'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { toggleBarberTodayOverride } from '@/lib/adminCrmApi';
import { createClient } from '@/utils/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Scissors, RefreshCw, Calendar, MoreVertical } from 'lucide-react';
import { Suspense } from 'react';

// ─── Constants ─────────────────────────────────────────────────────────────────

const DAY_KEYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const DAYS_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  minggu: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6,
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseWorkDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return (raw as string[])
    .map((d) => DAYS_MAP[String(d).trim().toLowerCase()])
    .filter((n): n is number => n !== undefined);
}

interface BarberRow {
  id: string;
  name: string;
  branch: string;
  is_active: boolean;
  img?: string | null;
  work_days?: unknown;
  today_count: number;
}

// ─── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ on, onChange, disabled }: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative flex-shrink-0 focus-visible:outline-none disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
      style={{ width: 44, height: 24 }}
    >
      <motion.div
        animate={{ backgroundColor: on ? '#16a34a' : '#3f1e22' }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0 rounded-full"
        style={{ border: `1px solid ${on ? 'rgba(34,197,94,0.4)' : 'rgba(199,40,32,0.25)'}` }}
      />
      <motion.div
        animate={{ x: on ? 22 : 2 }}
        transition={{ type: 'spring', stiffness: 550, damping: 38 }}
        className="absolute top-[3px] rounded-full bg-white shadow"
        style={{ width: 18, height: 18, left: 0 }}
      />
    </button>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────────────

function BarberCard({ barber, isOffToday, onToggle, toggling, index, upcomingCount, onOpenSheet }: {
  barber: BarberRow;
  isOffToday: boolean;
  onToggle: (id: string, available: boolean) => void;
  toggling: boolean;
  index: number;
  upcomingCount: number;
  onOpenSheet: () => void;
}) {
  const workDays = parseWorkDays(barber.work_days);
  const initials = barber.name.trim().slice(0, 2).toUpperCase();
  const isPermanentlyInactive = !barber.is_active;
  const effectivelyOff = isPermanentlyInactive || isOffToday;

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePointerDown = () => {
    pressTimer.current = setTimeout(() => onOpenSheet(), 500);
  };
  const handlePointerUp = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };

  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    };
  }, []);

  const borderColor = effectivelyOff
    ? 'rgba(199, 40, 32, 0.22)'
    : 'rgba(34, 197, 94, 0.25)';
  const bgColor = effectivelyOff
    ? 'rgba(199, 40, 32, 0.04)'
    : 'rgba(22, 163, 74, 0.04)';
  const dotColor = effectivelyOff ? '#C72820' : '#22c55e';
  const label = isPermanentlyInactive ? 'Nonaktif' : isOffToday ? 'Libur' : 'Aktif';
  const labelColor = effectivelyOff ? '#6B5A5E' : '#4ade80';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      layout
      className="rounded-2xl overflow-hidden"
      style={{ background: bgColor, border: `1px solid ${borderColor}` }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div className="flex items-center gap-3 px-4 py-3.5">

        {/* Avatar */}
        <div
          className="relative flex-shrink-0 rounded-full overflow-hidden bg-[#1a0e11]"
          style={{ width: 52, height: 52 }}
        >
          {barber.img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={barber.img}
              alt={barber.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-sm font-bold"
              style={{ color: '#E87068' }}
            >
              {initials}
            </div>
          )}

          {/* Upcoming blocks badge */}
          {upcomingCount > 0 && (
            <div
              className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
              style={{ background: '#C72820', color: 'white', border: '1.5px solid #070508' }}
            >
              {upcomingCount}
            </div>
          )}

          {/* Status dot */}
          <div
            className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full"
            style={{ background: dotColor, border: '2px solid #070508' }}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p
              className="font-semibold text-[14px] leading-tight capitalize truncate"
              style={{ color: '#F0EAEB' }}
            >
              {barber.name}
            </p>
            {barber.today_count > 0 && (
              <span
                className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md"
                style={{ background: 'rgba(199,40,32,0.12)', color: '#E87068' }}
              >
                {barber.today_count} hari ini
              </span>
            )}
            {upcomingCount > 0 && (
              <span
                className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md"
                style={{ background: 'rgba(199,40,32,0.10)', color: '#C72820' }}
              >
                {upcomingCount} libur terjadwal
              </span>
            )}
          </div>

          {/* Working days */}
          {workDays.length > 0 && (
            <div className="flex gap-[3px] mt-2">
              {DAY_KEYS.map((dayLabel, i) => {
                const works = workDays.includes(i);
                return (
                  <div
                    key={dayLabel}
                    className="flex items-center justify-center rounded text-[9px] font-semibold"
                    style={{
                      width: 24,
                      height: 18,
                      background: works
                        ? effectivelyOff
                          ? 'rgba(199,40,32,0.15)'
                          : 'rgba(34,197,94,0.15)'
                        : 'rgba(255,255,255,0.04)',
                      color: works
                        ? effectivelyOff ? '#E87068' : '#4ade80'
                        : '#2d1f23',
                    }}
                  >
                    {dayLabel}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Toggle + sheet trigger */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenSheet(); }}
            className="flex items-center justify-center rounded-lg cursor-pointer"
            style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#6B5A5E' }}
          >
            <MoreVertical size={14} />
          </button>
          <div className="flex flex-col items-center gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
            <Toggle
              on={!effectivelyOff}
              onChange={(val) => onToggle(barber.id, val)}
              disabled={toggling || isPermanentlyInactive}
            />
            <span
              className="text-[9px] font-semibold uppercase tracking-wider"
              style={{ color: labelColor }}
            >
              {label}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <motion.div
      animate={{ opacity: [0.3, 0.55, 0.3] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      className="rounded-2xl h-[86px]"
      style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.05)' }}
    />
  );
}

// ─── BarberSheet ────────────────────────────────────────────────────────────────

function BarberSheet({ barber, isOffToday, upcomingBlocks, onAction, onClose, actionLoading }: {
  barber: BarberRow;
  isOffToday: boolean;
  upcomingBlocks: string[];
  onAction: (date: string, available: boolean) => void;
  onClose: () => void;
  actionLoading: boolean;
}) {
  const [date, setDate] = useState(todayStr());

  return (
    <>
      {/* Overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.6)' }}
      />
      {/* Sheet */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl"
        style={{ background: '#1f1215', border: '1px solid rgba(255,255,255,0.07)', maxHeight: '80vh', overflowY: 'auto' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-3 pb-4">
          <div
            className="w-9 h-9 rounded-full flex-shrink-0 overflow-hidden"
            style={{ background: '#1a0e11' }}
          >
            {barber.img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={barber.img} alt={barber.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs font-bold" style={{ color: '#E87068' }}>
                {barber.name.trim().slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <p className="font-semibold text-[14px] capitalize" style={{ color: '#F0EAEB' }}>{barber.name}</p>
            <p className="text-[10px]" style={{ color: isOffToday ? '#C72820' : '#4ade80' }}>
              {isOffToday ? '● Libur hari ini' : '● Aktif hari ini'}
            </p>
          </div>
        </div>

        {/* Date picker section */}
        <div className="px-5 pb-4">
          <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-[10px] uppercase tracking-wider mb-3" style={{ color: '#6B5A5E' }}>Pilih Tanggal</p>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={{ background: '#2a1a1e', border: '1px solid rgba(255,255,255,0.1)', color: '#F0EAEB', colorScheme: 'dark' }}
            />
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                disabled={actionLoading || !date}
                onClick={() => onAction(date, false)}
                className="flex-1 rounded-xl py-2.5 text-[12px] font-semibold disabled:opacity-40"
                style={{ background: '#C72820', color: 'white' }}
              >
                {actionLoading ? '…' : 'Set Libur'}
              </button>
              <button
                type="button"
                disabled={actionLoading || !date}
                onClick={() => onAction(date, true)}
                className="flex-1 rounded-xl py-2.5 text-[12px] font-semibold disabled:opacity-40"
                style={{ background: 'rgba(22,163,74,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)' }}
              >
                {actionLoading ? '…' : 'Buka Lagi'}
              </button>
            </div>
          </div>
        </div>

        {/* Upcoming blocks list */}
        <div className="px-5 pb-8">
          <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#6B5A5E' }}>Libur Terjadwal</p>
          {upcomingBlocks.length === 0 ? (
            <p className="text-[11px] text-center py-3" style={{ color: '#3D2E32' }}>Tidak ada jadwal libur ke depan</p>
          ) : (
            <div className="space-y-2">
              {upcomingBlocks.map(d => (
                <div
                  key={d}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: 'rgba(199,40,32,0.06)', border: '1px solid rgba(199,40,32,0.15)' }}
                >
                  <Calendar size={13} style={{ color: '#C72820', flexShrink: 0 }} />
                  <span className="flex-1 text-[12px]" style={{ color: '#F0EAEB' }}>
                    {new Date(d + 'T12:00:00').toLocaleDateString('id-ID', {
                      weekday: 'long', day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </span>
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => onAction(d, true)}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-[11px] disabled:opacity-40 cursor-pointer"
                    style={{ background: 'rgba(199,40,32,0.15)', border: '1px solid rgba(199,40,32,0.2)', color: '#C72820' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

function BarbersPageInner() {
  const { user, loading: userLoading } = useUser();
  const searchParams = useSearchParams();
  const branch = searchParams.get('branch') ?? user?.branch ?? '';

  const [barbers, setBarbers] = useState<BarberRow[]>([]);
  const [offTodaySet, setOffTodaySet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [upcomingBlocksMap, setUpcomingBlocksMap] = useState<Record<string, string[]>>({});
  const [activeSheet, setActiveSheet] = useState<BarberRow | null>(null);
  const [sheetActionLoading, setSheetActionLoading] = useState(false);

  const loadBarbers = useCallback(async () => {
    if (!branch) return;
    setError(false);
    setOffTodaySet(new Set());
    setUpcomingBlocksMap({});

    const supabase = createClient();
    const today = todayStr();

    const [{ data: barberData, error: barberErr }, todayStatusRes] = await Promise.all([
      supabase
        .from('barbers')
        .select('id, name, branch, is_active, img, work_days')
        .eq('branch', branch)
        .order('name'),
      fetch(`/api/admin/barbers-today-status?date=${today}`).catch(() => null),
    ]);

    if (barberErr || !barberData) { setError(true); return; }

    const newOffSet = new Set<string>();
    if (todayStatusRes?.ok) {
      const ts = await todayStatusRes.json().catch(() => null);
      for (const b of ts?.barbers ?? []) {
        if (!b.isWorking) newOffSet.add(String(b.id));
      }
    } else {
      console.warn('[Barbers] today-status unavailable — showing all as available');
    }
    setOffTodaySet(newOffSet);

    const ids = barberData.map((b) => b.id);

    const [{ data: bookingData }, { data: blocksData }] = await Promise.all([
      supabase
        .from('bookings')
        .select('barber_id')
        .eq('date', today)
        .neq('status', 'cancelled')
        .in('barber_id', ids),
      supabase
        .from('barber_date_overrides')
        .select('barber_id, date')
        .in('barber_id', ids)
        .gte('date', today)
        .eq('is_off', true)
        .order('date', { ascending: true }),
    ]);

    const countMap: Record<string, number> = {};
    for (const bk of bookingData ?? []) {
      if (bk.barber_id) countMap[bk.barber_id] = (countMap[bk.barber_id] ?? 0) + 1;
    }

    const blocksMap: Record<string, string[]> = {};
    for (const b of blocksData ?? []) {
      if (!blocksMap[b.barber_id]) blocksMap[b.barber_id] = [];
      blocksMap[b.barber_id].push(b.date);
    }
    setUpcomingBlocksMap(blocksMap);

    setBarbers(barberData.map((b) => ({ ...b, today_count: countMap[b.id] ?? 0 })));
  }, [branch]);

  useEffect(() => {
    if (userLoading || !branch) return;
    setLoading(true);
    loadBarbers().finally(() => setLoading(false));
  }, [loadBarbers, userLoading, branch]);

  async function handleToggle(id: string, available: boolean) {
    setToggling(id);
    setOffTodaySet((prev) => {
      const next = new Set(prev);
      if (available) next.delete(id);
      else next.add(id);
      return next;
    });
    const res = await toggleBarberTodayOverride(id, available).catch(() => null);
    if (!res?.success) {
      setOffTodaySet((prev) => {
        const next = new Set(prev);
        if (available) next.add(id);
        else next.delete(id);
        return next;
      });
    }
    setToggling(null);
  }

  const isEffectivelyOff = (b: BarberRow) => !b.is_active || offTodaySet.has(b.id);

  const displayed = barbers.filter((b) =>
    filter === 'all' ? true : filter === 'active' ? !isEffectivelyOff(b) : isEffectivelyOff(b)
  );
  const activeCount = barbers.filter((b) => !isEffectivelyOff(b)).length;
  const inactiveCount = barbers.length - activeCount;

  return (
    <div className="px-4 pt-4 pb-8 space-y-4">

      {/* Header */}
      <div className="flex items-center">
        <Scissors size={14} style={{ color: '#C72820' }} className="mr-2 flex-shrink-0" />
        <h2 className="font-bold text-[15px]" style={{ color: '#F0EAEB' }}>Kapster</h2>

        {!loading && !error && (
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              <span style={{ color: '#6B5A5E' }}>{activeCount} aktif</span>
              <span style={{ color: '#3D2E32' }}>·</span>
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#C72820' }} />
              <span style={{ color: '#6B5A5E' }}>{inactiveCount} off</span>
            </div>
            <button
              onClick={() => { setLoading(true); loadBarbers().finally(() => setLoading(false)); }}
              className="p-1 rounded-lg cursor-pointer transition-opacity active:opacity-50"
              style={{ color: '#4A3E40' }}
            >
              <RefreshCw size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="flex gap-1.5">
        {(['all', 'active', 'inactive'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all cursor-pointer active:scale-95"
            style={filter === f
              ? { background: '#C72820', color: '#fff', border: '1px solid #C72820' }
              : { background: 'transparent', color: '#4A3E40', border: '1px solid rgba(255,255,255,0.07)' }
            }
          >
            {f === 'all' ? 'Semua' : f === 'active' ? 'Aktif' : 'Off'}
          </button>
        ))}
      </div>

      {/* Content */}
      <AnimatePresence mode="popLayout">
        {loading ? (
          <motion.div key="skel" className="space-y-2.5">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} />)}
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12 space-y-3"
          >
            <Calendar size={28} style={{ color: '#3D2E32', margin: '0 auto' }} />
            <p className="text-[13px]" style={{ color: '#6B5A5E' }}>Gagal memuat data kapster</p>
            <button
              onClick={() => { setLoading(true); loadBarbers().finally(() => setLoading(false)); }}
              className="text-[12px] px-4 py-2 rounded-full cursor-pointer active:scale-95 transition-all"
              style={{ background: 'rgba(199,40,32,0.12)', color: '#E87068', border: '1px solid rgba(199,40,32,0.2)' }}
            >
              Coba lagi
            </button>
          </motion.div>
        ) : displayed.length === 0 ? (
          <motion.p
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center text-[13px] py-12"
            style={{ color: '#4A3E40' }}
          >
            Tidak ada kapster
          </motion.p>
        ) : (
          <motion.div key="list" className="space-y-2">
            {displayed.map((b, i) => (
              <BarberCard
                key={b.id}
                barber={b}
                isOffToday={offTodaySet.has(b.id)}
                onToggle={handleToggle}
                toggling={toggling === b.id}
                index={i}
                upcomingCount={(upcomingBlocksMap[b.id] ?? []).length}
                onOpenSheet={() => setActiveSheet(b)}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function BarbersPage() {
  return <Suspense><BarbersPageInner /></Suspense>;
}
