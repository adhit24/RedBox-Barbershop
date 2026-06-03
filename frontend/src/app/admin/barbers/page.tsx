'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { toggleBarberActive } from '@/lib/adminCrmApi';
import { createClient } from '@/utils/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Scissors, RefreshCw } from 'lucide-react';
import Image from 'next/image';
import { Suspense } from 'react';

const DAYS_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const DAYS_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  minggu: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6,
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function workDayIndices(workDays: unknown): number[] {
  if (!Array.isArray(workDays) || !workDays.length) return [];
  return (workDays as string[])
    .map((d) => DAYS_MAP[String(d).toLowerCase()])
    .filter((n) => n !== undefined) as number[];
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

function Skeleton() {
  return (
    <motion.div
      animate={{ opacity: [0.35, 0.6, 0.35] }}
      transition={{ duration: 1.5, repeat: Infinity }}
      className="rounded-2xl h-44"
      style={{ background: 'rgba(255,255,255,0.04)' }}
    />
  );
}

function ToggleSwitch({ active, onChange, disabled }: {
  active: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={disabled}
      onClick={() => onChange(!active)}
      className="relative flex-shrink-0 focus:outline-none disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
    >
      <motion.div
        animate={{ backgroundColor: active ? '#C72820' : '#2A2326' }}
        transition={{ duration: 0.2 }}
        className="w-12 h-6 rounded-full border"
        style={{ borderColor: active ? 'rgba(199,40,32,0.4)' : 'rgba(255,255,255,0.08)' }}
      />
      <motion.div
        animate={{ x: active ? 26 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white shadow-md"
        style={{ left: 0 }}
      />
    </button>
  );
}

function BarberCard({ barber, onToggle, toggling, index }: {
  barber: BarberRow;
  onToggle: (id: string, val: boolean) => void;
  toggling: boolean;
  index: number;
}) {
  const initials = barber.name.slice(0, 2).toUpperCase();
  const activeDays = workDayIndices(barber.work_days);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.28, ease: 'easeOut' }}
      className="rounded-2xl overflow-hidden"
      style={{ background: '#0F0A0D', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Avatar + Name + Status */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        <div
          className="relative flex-shrink-0 w-12 h-12 rounded-full overflow-hidden"
          style={{ border: barber.is_active ? '2px solid rgba(199,40,32,0.5)' : '2px solid rgba(255,255,255,0.08)' }}
        >
          {barber.img ? (
            <Image src={barber.img} alt={barber.name} fill className="object-cover" />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-sm font-bold"
              style={{ background: 'rgba(199,40,32,0.12)', color: '#E87068' }}
            >
              {initials}
            </div>
          )}
          {barber.is_active && (
            <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0F0A0D]" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#F0EAEB] text-sm leading-tight truncate capitalize">{barber.name}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider mt-0.5" style={{ color: '#C72820' }}>
            {barber.branch}
          </p>
        </div>

        <AnimatePresence mode="wait">
          <motion.span
            key={barber.is_active ? 'aktif' : 'nonaktif'}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.15 }}
            className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
            style={barber.is_active
              ? { background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }
              : { background: 'rgba(199,40,32,0.12)', color: '#E87068', border: '1px solid rgba(199,40,32,0.25)' }
            }
          >
            {barber.is_active ? 'Aktif' : 'Nonaktif'}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Stats */}
      <div className="px-4 pb-3">
        <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="flex items-center justify-between">
            <span className="text-[11px]" style={{ color: '#6B5A5E' }}>Customer hari ini</span>
            <span className="text-[13px] font-semibold" style={{ color: '#F0EAEB' }}>{barber.today_count}</span>
          </div>
        </div>
      </div>

      {/* Working Days */}
      {activeDays.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: '#6B5A5E' }}>Hari Kerja</p>
          <div className="flex gap-1">
            {DAYS_SHORT.map((d, i) => {
              const isWork = activeDays.includes(i);
              return (
                <div
                  key={d}
                  className="flex-1 text-center py-1 rounded-lg text-[10px] font-semibold"
                  style={isWork
                    ? { background: 'rgba(199,40,32,0.15)', color: '#E87068', border: '1px solid rgba(199,40,32,0.25)' }
                    : { background: 'rgba(255,255,255,0.03)', color: '#3D2E32', border: '1px solid transparent' }
                  }
                >
                  {d}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Toggle */}
      <div
        className="px-4 pb-4 pt-2 flex items-center justify-between"
        style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
      >
        <p className="text-[11px]" style={{ color: barber.is_active ? '#34d399' : '#6B5A5E' }}>
          {barber.is_active ? 'Kapster bisa dipesan' : 'Kapster tidak bisa dipesan'}
        </p>
        <ToggleSwitch
          active={barber.is_active}
          onChange={(val) => onToggle(barber.id, val)}
          disabled={toggling}
        />
      </div>
    </motion.div>
  );
}

function BarbersPageInner() {
  const { user, loading: userLoading } = useUser();
  const branch = user?.branch || '';

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

    // Fetch barbers by branch directly from Supabase
    const { data: barberData, error: barberErr } = await supabase
      .from('barbers')
      .select('id, name, branch, is_active, img, work_days')
      .eq('branch', branch)
      .order('name');

    if (barberErr || !barberData) {
      setError(true);
      return;
    }

    // Fetch today's booking counts per barber
    const { data: bookingData } = await supabase
      .from('bookings')
      .select('barber_id')
      .eq('date', today)
      .neq('status', 'cancelled')
      .in('barber_id', barberData.map((b) => b.id));

    const countMap: Record<string, number> = {};
    for (const bk of bookingData ?? []) {
      if (bk.barber_id) countMap[bk.barber_id] = (countMap[bk.barber_id] ?? 0) + 1;
    }

    setBarbers(
      barberData.map((b) => ({ ...b, today_count: countMap[b.id] ?? 0 }))
    );
  }, [branch]);

  useEffect(() => {
    if (userLoading || !branch) return;
    setLoading(true);
    loadBarbers().finally(() => setLoading(false));
  }, [loadBarbers, userLoading, branch]);

  async function handleToggle(id: string, val: boolean) {
    setToggling(id);
    // Optimistic update
    setBarbers((prev) => prev.map((b) => (b.id === id ? { ...b, is_active: val } : b)));

    // Call toggle API (also busts backend barbers cache)
    const res = await toggleBarberActive(id, val).catch(() => null);
    if (!res?.success && !res?.ok) {
      // Revert on failure
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
    <div className="p-4 space-y-4 pb-8">

      {/* Header */}
      <div className="flex items-center gap-2">
        <Scissors size={15} style={{ color: '#C72820' }} />
        <h2 className="font-bold text-base" style={{ color: '#F0EAEB' }}>Kapster</h2>
        {!loading && !error && (
          <span className="ml-auto text-[11px]" style={{ color: '#6B5A5E' }}>
            {activeCount} aktif · {inactiveCount} nonaktif
          </span>
        )}
        {!loading && (
          <button
            onClick={() => { setLoading(true); loadBarbers().finally(() => setLoading(false)); }}
            className="p-1.5 rounded-lg cursor-pointer transition-colors"
            style={{ color: '#4A3E40' }}
          >
            <RefreshCw size={13} />
          </button>
        )}
      </div>

      {/* Filter pills */}
      <div className="flex gap-2">
        {(['all', 'active', 'inactive'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all cursor-pointer"
            style={filter === f
              ? { background: '#C72820', color: '#fff' }
              : { background: 'rgba(255,255,255,0.04)', color: '#6B5A5E', border: '1px solid rgba(255,255,255,0.07)' }
            }
          >
            {f === 'all' ? 'Semua' : f === 'active' ? 'Aktif' : 'Nonaktif'}
          </button>
        ))}
      </div>

      {/* Content */}
      <AnimatePresence mode="popLayout">
        {loading ? (
          <motion.div key="skel" className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} />)}
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-10 space-y-2"
          >
            <p className="text-sm" style={{ color: '#6B5A5E' }}>Gagal memuat data kapster</p>
            <button
              onClick={() => { setLoading(true); loadBarbers().finally(() => setLoading(false)); }}
              className="text-xs px-4 py-2 rounded-full cursor-pointer"
              style={{ background: 'rgba(199,40,32,0.15)', color: '#E87068' }}
            >
              Coba lagi
            </button>
          </motion.div>
        ) : displayed.length === 0 ? (
          <motion.p
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center text-sm py-10"
            style={{ color: '#6B5A5E' }}
          >
            Tidak ada kapster
          </motion.p>
        ) : (
          <motion.div key="cards" className="space-y-3">
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
