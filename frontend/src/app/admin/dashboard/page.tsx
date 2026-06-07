'use client';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchCommandCenter } from '@/lib/adminCrmApi';
import type { CommandCenterData, BookingRow, BarberWithStatus, MokaOpenBill } from '@/lib/adminCrmTypes';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, Home,
  Users, CalendarCheck, RefreshCw,
  ChevronRight, Circle, ShoppingBag,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '@/utils/supabase/client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  pending:     { label: 'Pending',      color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',    dot: 'bg-amber-400' },
  confirmed:   { label: 'Confirmed',    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',       dot: 'bg-blue-400' },
  done:        { label: 'Selesai',      color: 'bg-green-500/15 text-green-400 border-green-500/30',    dot: 'bg-green-400' },
  cancelled:   { label: 'Cancelled',    color: 'bg-red-500/15 text-red-400 border-red-500/30',          dot: 'bg-red-400' },
  no_show:     { label: 'No-show',      color: 'bg-slate-500/15 text-slate-400 border-slate-500/30',    dot: 'bg-slate-400' },
  departed:    { label: 'Berangkat',    color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30', dot: 'bg-indigo-400' },
  arrived:     { label: 'Tiba',         color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',       dot: 'bg-cyan-400' },
  in_progress: { label: 'Dikerjakan',   color: 'bg-purple-500/15 text-purple-400 border-purple-500/30', dot: 'bg-purple-400' },
};

const HS_NEXT: Record<string, string> = {
  confirmed: 'departed', departed: 'arrived', arrived: 'in_progress', in_progress: 'done',
};
const HS_BTN: Record<string, string> = {
  confirmed: 'Tandai Berangkat', departed: 'Tandai Sampai', arrived: 'Mulai', in_progress: 'Selesai',
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, color: 'bg-slate-500/15 text-slate-400 border-slate-500/30', dot: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
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

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, color, index, onClick, isActive, accentColor,
}: {
  label: string; value: number; color: string; index: number;
  onClick?: () => void; isActive?: boolean; accentColor?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3, ease: 'easeOut' }}
      onClick={onClick}
      className={`bg-[#0F172A] border border-slate-800 rounded-2xl p-3 text-center relative transition-all${onClick ? ' cursor-pointer active:scale-95 select-none' : ''}`}
      style={{ borderColor: isActive && accentColor ? accentColor : undefined }}
    >
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">{label}</p>
      {isActive && accentColor && (
        <span
          className="absolute -bottom-[2px] left-1/2 -translate-x-1/2 w-5 h-[3px] rounded-full"
          style={{ background: accentColor }}
        />
      )}
    </motion.div>
  );
}

// ─── Booking Card ─────────────────────────────────────────────────────────────

function BookingCard({ bk, onAction, index }: {
  bk: BookingRow;
  onAction: (id: string, status: string) => void;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, duration: 0.25, ease: 'easeOut' }}
      className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3 space-y-2.5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-white text-sm truncate">{bk.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">{bk.time} · {bk.service}</p>
        </div>
        <StatusBadge status={bk.status} />
      </div>
      {bk.status === 'pending' && (
        <div className="flex gap-2">
          <button
            onClick={() => onAction(bk.id, 'confirmed')}
            className="flex-1 h-9 text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/30 rounded-xl hover:bg-green-500/25 active:scale-95 transition-all cursor-pointer"
          >
            Konfirmasi
          </button>
          <button
            onClick={() => onAction(bk.id, 'cancelled')}
            className="flex-1 h-9 text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30 rounded-xl hover:bg-red-500/25 active:scale-95 transition-all cursor-pointer"
          >
            Batalkan
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ─── Home Service Card ────────────────────────────────────────────────────────

function HomeServiceCard({ hs, onAdvance, index, readonly }: {
  hs: BookingRow;
  onAdvance: (id: string, next: string) => void;
  index: number;
  readonly?: boolean;
}) {
  const next = HS_NEXT[hs.status];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.28 }}
      className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3 space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Home size={14} className="text-slate-500 flex-shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-white text-sm truncate">{hs.name}</p>
            <p className="text-xs text-slate-500">{hs.time}</p>
          </div>
        </div>
        <StatusBadge status={hs.status} />
      </div>
      {next && !readonly && (
        <button
          onClick={() => onAdvance(hs.id, next)}
          className="w-full h-9 text-xs font-semibold bg-slate-700/60 text-slate-200 border border-slate-600 rounded-xl hover:bg-slate-700 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1.5"
        >
          <ChevronRight size={14} />
          {HS_BTN[hs.status]}
        </button>
      )}
    </motion.div>
  );
}

// ─── Moka Open Bill Card ──────────────────────────────────────────────────────

function MokaCard({ bill, index }: {
  bill: { id: string; barber_name: string; service_name: string; time: string; unassigned: boolean };
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, duration: 0.22 }}
      className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3 flex items-center justify-between gap-2"
    >
      <div className="min-w-0">
        <p className="font-semibold text-white text-sm truncate">{bill.service_name}</p>
        <p className="text-xs text-slate-500 mt-0.5">{bill.time} · {bill.barber_name}</p>
      </div>
      {bill.unassigned && (
        <span className="flex-shrink-0 text-[11px] bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full">
          Unassigned
        </span>
      )}
    </motion.div>
  );
}

// ─── Stat Detail Sheet ───────────────────────────────────────────────────────

type SheetType = 'hadir' | 'tidak_hadir' | 'belum_checkin' | 'booking' | 'pending' | 'goshow';

const SHEET_TITLES: Record<SheetType, string> = {
  hadir:         'Kapster Hadir',
  tidak_hadir:   'Tidak Hadir',
  belum_checkin: 'Belum Check-in',
  booking:       'Booking Hari Ini',
  pending:       'Menunggu Konfirmasi',
  goshow:        'GoShow Moka',
};

function StatDetailSheet({
  type, data, onAction, onClose,
}: {
  type: SheetType;
  data: CommandCenterData;
  onAction: (id: string, status: string) => Promise<void>;
  onClose: () => void;
}) {
  const [acting, setActing] = useState<string | null>(null);

  async function handleAction(id: string, status: string) {
    setActing(id + ':' + status);
    try {
      await onAction(id, status);
    } finally {
      setActing(null);
    }
  }

  function getRows(): unknown[] {
    switch (type) {
      case 'hadir':
        return data.barbers.filter(b => b.attendance_status === 'hadir' || b.attendance_status === 'terlambat');
      case 'tidak_hadir':
        return data.barbers.filter(b => b.attendance_status && b.attendance_status !== 'hadir' && b.attendance_status !== 'terlambat');
      case 'belum_checkin':
        return data.barbers.filter(b => !b.attendance_status);
      case 'booking':
        return data.booking_feed;
      case 'pending':
        return data.booking_feed.filter(b => b.status === 'pending');
      case 'goshow':
        return data.moka_open_bills;
    }
  }

  const rows = getRows();

  function renderRow(row: unknown, i: number): React.ReactNode {
    if (type === 'hadir' || type === 'tidak_hadir' || type === 'belum_checkin') {
      const b = row as BarberWithStatus;
      const badge =
        b.attendance_status === 'hadir'     ? { label: 'Hadir',     cls: 'bg-green-500/15 text-green-400 border-green-500/30' } :
        b.attendance_status === 'terlambat' ? { label: 'Terlambat', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' } :
        b.attendance_status               ? { label: b.attendance_status, cls: 'bg-red-500/15 text-red-400 border-red-500/30' } :
                                            { label: 'Menunggu',   cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
      return (
        <div key={b.id} className={`flex items-center justify-between py-2.5 ${i > 0 ? 'border-t border-slate-800/60' : ''}`}>
          <div>
            <p className="text-sm font-semibold text-white">{b.name}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {b.attendance_status ? `Check-in · ${b.today_count} customer` : 'Shift hari ini, belum absen'}
            </p>
          </div>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${badge.cls}`}>{badge.label}</span>
        </div>
      );
    }

    if (type === 'booking' || type === 'pending') {
      const bk = row as BookingRow;
      const isPending = bk.status === 'pending';
      return (
        <div key={bk.id} className={`py-2.5 ${i > 0 ? 'border-t border-slate-800/60' : ''}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{bk.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">{bk.time} · {bk.service}</p>
            </div>
            <StatusBadge status={bk.status} />
          </div>
          {isPending && (
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => handleAction(bk.id, 'confirmed')}
                disabled={acting !== null}
                className="flex-1 h-8 text-xs font-bold bg-green-500/15 text-green-400 border border-green-500/30 rounded-xl hover:bg-green-500/25 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
              >
                {acting === bk.id + ':confirmed' ? '...' : '✓ Konfirmasi'}
              </button>
              <button
                onClick={() => handleAction(bk.id, 'cancelled')}
                disabled={acting !== null}
                className="flex-1 h-8 text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/30 rounded-xl hover:bg-red-500/25 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
              >
                {acting === bk.id + ':cancelled' ? '...' : '✕ Batalkan'}
              </button>
            </div>
          )}
        </div>
      );
    }

    if (type === 'goshow') {
      const bill = row as MokaOpenBill;
      return (
        <div key={bill.id} className={`flex items-center justify-between py-2.5 ${i > 0 ? 'border-t border-slate-800/60' : ''}`}>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{bill.service_name}</p>
            <p className="text-xs text-slate-500 mt-0.5">{bill.time} · {bill.barber_name}</p>
          </div>
          {bill.unassigned
            ? <span className="text-[11px] bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-medium flex-shrink-0">Unassigned</span>
            : <span className="text-[11px] bg-teal-500/15 text-teal-400 border border-teal-500/30 px-2 py-0.5 rounded-full font-medium flex-shrink-0">Open</span>
          }
        </div>
      );
    }

    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      {/* Sheet */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
        className="fixed bottom-0 left-0 right-0 z-50 bg-[#111827] border-t-2 border-slate-800 rounded-t-2xl max-h-[70vh] flex flex-col"
      >
        {/* Drag handle — tap to close */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-pointer" onClick={onClose}>
          <div className="w-8 h-1 rounded-full bg-slate-700" />
        </div>
        {/* Title */}
        <div className="px-4 pt-1 pb-2 flex-shrink-0">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
            {SHEET_TITLES[type]} ({rows.length})
          </p>
        </div>
        {/* Rows */}
        <div className="overflow-y-auto px-4 pb-8">
          {rows.length === 0
            ? <p className="text-slate-600 text-sm text-center py-10">Belum ada data</p>
            : rows.map((row, i) => renderRow(row, i))
          }
        </div>
      </motion.div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function CommandCenterPageInner() {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const readonly = searchParams.get('readonly') === 'true';
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const loadRef = useRef<(silent?: boolean) => void>(() => {});
  const branch = user?.branch || '';

  const load = useCallback(async (silent = false) => {
    if (!branch) { if (!silent) setLoading(false); return; }
    if (!silent) setLoading(true);
    else setRefreshing(true);
    const d = await fetchCommandCenter(branch).catch(() => null);
    if (d) setData(d);
    setLoading(false);
    setRefreshing(false);
  }, [branch]);

  useEffect(() => { loadRef.current = load; }, [load]);

  function handleCardClick(type: string) {
    setActiveCard(prev => prev === type ? null : type);
  }

  useEffect(() => {
    load();
    const iv = setInterval(() => load(true), 30000);
    return () => clearInterval(iv);
  }, [load]);

  // Supabase Realtime — booking INSERT/UPDATE per branch
  useEffect(() => {
    if (!branch) return;
    const supabase = createClient();
    const ch = supabase
      .channel(`dashboard-bookings-${branch}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bookings', filter: `location=eq.${branch}` },
        () => loadRef.current(true)
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `location=eq.${branch}` },
        () => loadRef.current(true)
      )
      .subscribe(status => setLive(status === 'SUBSCRIBED'));
    return () => { supabase.removeChannel(ch); };
  }, [branch]); // eslint-disable-line react-hooks/exhaustive-deps

  async function updateStatus(id: string, status: string) {
    await fetch('/api/admin/booking-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    load(true);
  }

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex justify-between items-center">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-slate-500 text-sm">
        Gagal memuat data
      </div>
    );
  }

  const stats = [
    { label: 'Hadir',        value: data.stats.hadir,                color: 'text-green-400',  type: 'hadir',         accentColor: '#4ade80' },
    { label: 'Tdk Hadir',    value: data.stats.tidak_hadir,          color: 'text-red-400',    type: 'tidak_hadir',   accentColor: '#f87171' },
    { label: 'Blm Check-in', value: data.stats.belum_check_in,       color: 'text-amber-400',  type: 'belum_checkin', accentColor: '#fbbf24' },
    { label: 'Booking',      value: data.stats.booking_today,        color: 'text-blue-400',   type: 'booking',       accentColor: '#60a5fa' },
    { label: 'Pending',      value: data.stats.pending,              color: 'text-orange-400', type: 'pending',       accentColor: '#fb923c' },
    { label: 'GoShow',       value: data.stats.moka_open_bills ?? 0, color: 'text-teal-400',   type: 'goshow',        accentColor: '#2dd4bf' },
  ];

  return (
    <div className="p-4 space-y-5 pb-6">

      {/* Title row */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-white font-bold text-base capitalize">{branch}</h2>
            {live && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                LIVE
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500">{data.today}</p>
        </div>
        <button
          onClick={() => load(true)}
          className="p-2 rounded-xl bg-slate-800 text-slate-400 active:scale-95 transition-all cursor-pointer"
          aria-label="Refresh"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Alerts */}
      <AnimatePresence>
        {data.alerts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            {data.alerts.map((a, i) => (
              <div key={i} className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/25 rounded-2xl px-3.5 py-2.5">
                <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300 leading-relaxed">{a.message}</p>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s, i) => (
          <StatCard
            key={s.label}
            {...s}
            index={i}
            isActive={activeCard === s.type}
            onClick={() => handleCardClick(s.type)}
          />
        ))}
      </div>

      {/* Home Service Tracker */}
      {data.home_service.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            <Home size={13} className="text-slate-500" />
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Home Service Aktif</p>
          </div>
          {data.home_service.map((hs, i) => (
            <HomeServiceCard key={hs.id} hs={hs} onAdvance={updateStatus} index={i} readonly={readonly} />
          ))}
        </section>
      )}

      {/* Moka GoShow Open Bills */}
      {(data.moka_open_bills?.length ?? 0) > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            <ShoppingBag size={13} className="text-teal-500" />
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">GoShow Moka</p>
            <span className="ml-auto text-[11px] text-teal-400 tabular-nums">{data.moka_open_bills.length} open</span>
          </div>
          {data.moka_open_bills.map((bill, i) => (
            <MokaCard key={bill.id} bill={bill} index={i} />
          ))}
        </section>
      )}

      {/* Booking Feed */}
      {data.booking_feed.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            <CalendarCheck size={13} className="text-slate-500" />
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Booking Masuk</p>
          </div>
          {data.booking_feed.map((bk, i) => (
            <BookingCard key={bk.id} bk={bk} onAction={updateStatus} index={i} />
          ))}
        </section>
      )}

      {/* Kapster On-Duty */}
      <section className="space-y-2.5">
        <div className="flex items-center gap-1.5">
          <Users size={13} className="text-slate-500" />
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Kapster Hari Ini</p>
        </div>
        <div className="bg-[#0F172A] border border-slate-800 rounded-2xl overflow-hidden">
          {data.barbers.map((b, i) => {
            const isPresent = b.attendance_status === 'hadir' || b.attendance_status === 'terlambat';
            const isAbsent = b.attendance_status && !isPresent;
            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.04 }}
                className={`flex items-center justify-between px-4 py-2.5 ${i > 0 ? 'border-t border-slate-800/70' : ''}`}
              >
                <div className="flex items-center gap-2.5">
                  <Circle
                    size={8}
                    className={`fill-current ${isPresent ? 'text-green-400' : isAbsent ? 'text-red-400' : 'text-slate-600'}`}
                  />
                  <p className="text-sm text-slate-200 font-medium">{b.name}</p>
                </div>
                <div className="flex items-center gap-3">
                  {b.attendance_status && (
                    <span className="text-[11px] text-slate-500 capitalize">{b.attendance_status}</span>
                  )}
                  <span className="text-sm font-bold text-slate-300 tabular-nums">{b.today_count}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Bottom Sheet */}
      <AnimatePresence>
        {activeCard && data && (
          <StatDetailSheet
            type={activeCard as SheetType}
            data={data}
            onAction={async (id, status) => {
              await fetch('/api/admin/booking-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status }),
              });
              load(true);
            }}
            onClose={() => setActiveCard(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function CommandCenterPage() {
  return <Suspense><CommandCenterPageInner /></Suspense>;
}
