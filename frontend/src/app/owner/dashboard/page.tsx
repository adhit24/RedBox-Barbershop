'use client';
import { useEffect, useState, useCallback } from 'react';
import { fetchOwnerOverview } from '@/lib/adminCrmApi';
import type { OwnerOverviewData, OwnerBranchSummary } from '@/lib/adminCrmTypes';
import { motion } from 'framer-motion';
import { RefreshCw, TrendingUp, ChevronRight, Users, ShoppingBag, CalendarCheck, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}rb`;
  return `${n}`;
}

function Skeleton({ className }: { className?: string }) {
  return (
    <motion.div animate={{ opacity: [0.4, 0.7, 0.4] }}
      transition={{ duration: 1.4, repeat: Infinity }}
      className={`bg-slate-800 rounded-lg ${className}`} />
  );
}

function TotalBar({ totals }: { totals: OwnerOverviewData['totals'] }) {
  const items = [
    { label: 'Moka',    value: fmt(totals.revenue_moka), color: 'text-teal-400' },
    { label: 'Web',     value: fmt(totals.revenue_web),  color: 'text-blue-400' },
    { label: 'Tx',      value: String(totals.tx_total),  color: 'text-slate-300' },
    { label: 'Hadir',   value: String(totals.hadir),     color: 'text-green-400' },
    { label: 'GoShow',  value: String(totals.goshow),    color: 'text-amber-400' },
    { label: 'Pending', value: String(totals.pending),   color: 'text-orange-400' },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((item, i) => (
        <motion.div key={item.label}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className="bg-[#0F172A] border border-slate-800 rounded-2xl px-3 py-2.5 text-center">
          <p className={`text-base font-bold tabular-nums ${item.color}`}>{item.value}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{item.label}</p>
        </motion.div>
      ))}
    </div>
  );
}

function BranchCard({ branch, index, onClick }: { branch: OwnerBranchSummary; index: number; onClick: () => void }) {
  const totalRevenue = branch.revenue_moka + branch.revenue_web;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.25 }}
      onClick={onClick}
      className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3.5 cursor-pointer active:scale-[0.98] transition-all"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="font-bold text-white text-sm capitalize">{branch.name.replace('RedBox ', '').replace('Redbox ', '')}</p>
        <div className="flex items-center gap-1 text-slate-500">
          <span className="text-xs font-semibold text-slate-300">Rp {fmt(totalRevenue)}</span>
          <ChevronRight size={14} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-1.5">
          <ShoppingBag size={11} className="text-teal-500" />
          <span className="text-[11px] text-slate-400">Moka: <span className="text-teal-400 font-semibold">Rp {fmt(branch.revenue_moka)}</span> ({branch.tx_moka}tx)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <CalendarCheck size={11} className="text-blue-500" />
          <span className="text-[11px] text-slate-400">Web: <span className="text-blue-400 font-semibold">Rp {fmt(branch.revenue_web)}</span> ({branch.tx_web}tx)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Users size={11} className="text-green-500" />
          <span className="text-[11px] text-slate-400">Hadir: <span className="text-green-400 font-semibold">{branch.hadir}/{branch.total_barbers}</span></span>
        </div>
        <div className="flex items-center gap-1.5">
          <AlertCircle size={11} className="text-amber-500" />
          <span className="text-[11px] text-slate-400">GoShow: <span className="text-amber-400 font-semibold">{branch.goshow}</span> · Pending: <span className="text-orange-400 font-semibold">{branch.pending_bookings}</span></span>
        </div>
      </div>
    </motion.div>
  );
}

export default function OwnerDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<OwnerOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const d = await fetchOwnerOverview().catch(() => null);
    if (d) setData(d);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="p-4 space-y-4 pb-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] text-slate-500">{data?.today ?? '...'}</p>
          <p className="text-xs text-slate-600 mt-0.5">Semua Cabang</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/owner/revenue')}
            className="flex items-center gap-1.5 bg-slate-800 text-slate-300 text-xs px-3 py-1.5 rounded-xl border border-slate-700 active:scale-95 transition-all cursor-pointer">
            <TrendingUp size={13} />
            Revenue
          </button>
          <button onClick={() => load(true)}
            className="p-2 rounded-xl bg-slate-800 text-slate-400 active:scale-95 transition-all cursor-pointer">
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">{Array.from({length:6}).map((_,i) => <Skeleton key={i} className="h-14" />)}</div>
          {Array.from({length:3}).map((_,i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : !data ? (
        <p className="text-center text-slate-500 text-sm py-12">Gagal memuat data</p>
      ) : (
        <>
          <TotalBar totals={data.totals} />
          <div className="space-y-2.5">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Per Cabang</p>
            {data.branches.map((b, i) => (
              <BranchCard key={b.slug} branch={b} index={i}
                onClick={() => router.push(`/admin/dashboard?branch=${b.slug}&readonly=true`)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
