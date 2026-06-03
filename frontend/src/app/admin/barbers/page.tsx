'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { toggleBarberActive } from '@/lib/adminCrmApi';
import { createClient } from '@/utils/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Scissors, RefreshCw, Calendar } from 'lucide-react';
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

function BarberCard({ barber, onToggle, toggling, index }: {
  barber: BarberRow;
  onToggle: (id: string, val: boolean) => void;
  toggling: boolean;
  index: number;
}) {
  const workDays = parseWorkDays(barber.work_days);
  const initials = barber.name.trim().slice(0, 2).toUpperCase();

  const borderColor = barber.is_active
    ? 'rgba(34, 197, 94, 0.25)'
    : 'rgba(199, 40, 32, 0.22)';
  const bgColor = barber.is_active
    ? 'rgba(22, 163, 74, 0.04)'
    : 'rgba(199, 40, 32, 0.04)';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      layout
      className="rounded-2xl overflow-hidden"
      style={{ background: bgColor, border: `1px solid ${borderColor}` }}
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

          {/* Status dot */}
          <div
            className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full"
            style={{
              background: barber.is_active ? '#22c55e' : '#C72820',
              border: '2px solid #070508',
            }}
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
          </div>

          {/* Working days */}
          {workDays.length > 0 && (
            <div className="flex gap-[3px] mt-2">
              {DAY_KEYS.map((label, i) => {
                const works = workDays.includes(i);
                return (
                  <div
                    key={label}
                    className="flex items-center justify-center rounded text-[9px] font-semibold"
                    style={{
                      width: 24,
                      height: 18,
                      background: works
                        ? barber.is_active
                          ? 'rgba(34,197,94,0.15)'
                          : 'rgba(199,40,32,0.15)'
                        : 'rgba(255,255,255,0.04)',
                      color: works
                        ? barber.is_active ? '#4ade80' : '#E87068'
                        : '#2d1f23',
                    }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Toggle */}
        <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
          <Toggle
            on={barber.is_active}
            onChange={(val) => onToggle(barber.id, val)}
            disabled={toggling}
          />
          <span
            className="text-[9px] font-semibold uppercase tracking-wider"
            style={{ color: barber.is_active ? '#4ade80' : '#6B5A5E' }}
          >
            {barber.is_active ? 'Aktif' : 'Off'}
          </span>
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

// ─── Page ──────────────────────────────────────────────────────────────────────

function BarbersPageInner() {
  const { user, loading: userLoading } = useUser();
  const branch = user?.branch ?? '';

  const [barbers, setBarbers] = useState<BarberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const loadBarbers = useCallback(async () => {
    if (!branch) return;
    setError(false);

    const supabase = createClient();
    const today = todayStr();

    const { data: barberData, error: barberErr } = await supabase
      .from('barbers')
      .select('id, name, branch, is_active, img, work_days')
      .eq('branch', branch)
      .order('name');

    if (barberErr || !barberData) { setError(true); return; }

    const ids = barberData.map((b) => b.id);
    const { data: bookingData } = await supabase
      .from('bookings')
      .select('barber_id')
      .eq('date', today)
      .neq('status', 'cancelled')
      .in('barber_id', ids);

    const countMap: Record<string, number> = {};
    for (const bk of bookingData ?? []) {
      if (bk.barber_id) countMap[bk.barber_id] = (countMap[bk.barber_id] ?? 0) + 1;
    }

    setBarbers(barberData.map((b) => ({ ...b, today_count: countMap[b.id] ?? 0 })));
  }, [branch]);

  useEffect(() => {
    if (userLoading || !branch) return;
    setLoading(true);
    loadBarbers().finally(() => setLoading(false));
  }, [loadBarbers, userLoading, branch]);

  async function handleToggle(id: string, val: boolean) {
    setToggling(id);
    setBarbers((prev) => prev.map((b) => (b.id === id ? { ...b, is_active: val } : b)));
    const res = await toggleBarberActive(id, val).catch(() => null);
    if (!res?.success && !res?.ok) {
      setBarbers((prev) => prev.map((b) => (b.id === id ? { ...b, is_active: !val } : b)));
    }
    setToggling(null);
  }

  const displayed = barbers.filter((b) =>
    filter === 'all' ? true : filter === 'active' ? b.is_active : !b.is_active
  );
  const activeCount = barbers.filter((b) => b.is_active).length;
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
                onToggle={handleToggle}
                toggling={toggling === b.id}
                index={i}
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
