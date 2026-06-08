'use client';
import { useEffect, useState, useCallback } from 'react';
import { fetchPaymentAnalytics } from '@/lib/adminCrmApi';
import type { PaymentAnalyticsData } from '@/lib/adminCrmTypes';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { CreditCard, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

const BRANCHES = [
  { key: 'all',       label: 'Semua' },
  { key: 'bypass',    label: 'Bypass' },
  { key: 'samadikun', label: 'Samadikun' },
  { key: 'csb',       label: 'CSB' },
  { key: 'sumber',    label: 'Sumber' },
  { key: 'tegal',     label: 'Tegal' },
];

const PERIODS = [
  { key: 'today', label: 'Hari ini' },
  { key: '7d',    label: '7 Hari' },
  { key: '30d',   label: '30 Hari' },
  { key: 'month', label: 'Bulan ini' },
];

const COLORS: Record<string, string> = {
  cash: '#3b82f6', qris: '#8b5cf6', transfer: '#14b8a6', other: '#f59e0b',
};

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}rb`;
  return String(n);
}

function Skeleton({ className }: { className?: string }) {
  return (
    <motion.div animate={{ opacity: [0.4, 0.7, 0.4] }}
      transition={{ duration: 1.4, repeat: Infinity }}
      className={`bg-slate-800 rounded-lg ${className}`} />
  );
}

export default function OwnerPaymentPage() {
  const [branch, setBranch] = useState('all');
  const [period, setPeriod] = useState('30d');
  const [data, setData]     = useState<PaymentAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchPaymentAnalytics(branch, period).catch(() => null);
    if (d) setData(d);
    setLoading(false);
  }, [branch, period]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 space-y-4 pb-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link href="/owner/revenue" className="text-slate-500 active:scale-95 transition-transform">
          <ArrowLeft size={18} />
        </Link>
        <CreditCard size={15} className="text-slate-500" />
        <h2 className="text-white font-bold text-base">Payment Analytics</h2>
      </div>

      {/* Branch filter */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1">
        {BRANCHES.map(b => (
          <button key={b.key} onClick={() => setBranch(b.key)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              branch === b.key ? 'bg-slate-700 text-white border-slate-600' : 'bg-transparent text-slate-500 border-slate-800'
            }`}>
            {b.label}
          </button>
        ))}
      </div>

      {/* Period filter */}
      <div className="flex gap-1.5 bg-slate-900 p-1 rounded-2xl">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={`flex-1 py-1.5 rounded-xl text-[11px] font-semibold transition-all cursor-pointer ${
              period === p.key ? 'bg-slate-700 text-white' : 'text-slate-500'
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
          <Skeleton className="h-40" />
        </div>
      ) : !data ? (
        <p className="text-center text-slate-500 text-sm py-12">Gagal memuat data</p>
      ) : (
        <motion.div
          key={`${branch}-${period}`}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-2">
            {data.methods.map((m, i) => {
              const color = COLORS[m.key] ?? '#64748b';
              const grandTotal = data.methods.reduce((s, x) => s + x.total, 0);
              const barPct = grandTotal > 0 ? (m.total / grandTotal) * 100 : 0;
              return (
                <motion.div key={m.key}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3 relative overflow-hidden"
                  style={{ borderTop: `2px solid ${color}` }}
                >
                  <p className="text-[9px] uppercase tracking-widest font-semibold mb-1" style={{ color: '#64748b' }}>{m.name}</p>
                  <p className="text-base font-bold tabular-nums" style={{ color }}>Rp {fmt(m.total)}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: '#475569' }}>{m.tx_count} tx · {m.pct}%</p>
                  {/* Progress bar */}
                  <div className="mt-2 h-1 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }} animate={{ width: `${barPct}%` }}
                      transition={{ delay: i * 0.05 + 0.1, duration: 0.5 }}
                      className="h-full rounded-full"
                      style={{ background: color }}
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Stacked trend chart */}
          {data.daily_trend.length > 1 && (
            <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Tren Harian</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data.daily_trend.map(d => ({ ...d, date: d.date.slice(5) }))} barSize={6} barGap={1}>
                  <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#64748b' }} />
                  <YAxis hide />
                  <Tooltip
                    formatter={(v: any, name: any) => [`Rp ${fmt(v)}`, (name as string)?.charAt(0).toUpperCase() + (name as string)?.slice(1)]}
                    contentStyle={{ background: '#0F172A', border: '1px solid #1e293b', borderRadius: 8, fontSize: 11 }}
                  />
                  <Bar dataKey="cash"     stackId="a" fill={COLORS.cash}     radius={[0,0,0,0]} />
                  <Bar dataKey="qris"     stackId="a" fill={COLORS.qris}     radius={[0,0,0,0]} />
                  <Bar dataKey="transfer" stackId="a" fill={COLORS.transfer} radius={[0,0,0,0]} />
                  <Bar dataKey="other"    stackId="a" fill={COLORS.other}    radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 mt-2">
                {(['cash','qris','transfer','other'] as const).map(k => (
                  <span key={k} className="flex items-center gap-1 text-[10px] text-slate-500">
                    <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: COLORS[k] }} />
                    {k.charAt(0).toUpperCase() + k.slice(1)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Per branch table */}
          {data.by_branch.length > 0 && (
            <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Per Cabang</p>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs min-w-[400px]">
                  <thead>
                    <tr className="text-slate-500 text-[9px] uppercase tracking-wider">
                      <th className="text-left pb-2 px-1">Cabang</th>
                      <th className="text-right pb-2 px-1" style={{ color: COLORS.cash }}>Cash</th>
                      <th className="text-right pb-2 px-1" style={{ color: COLORS.qris }}>QRIS</th>
                      <th className="text-right pb-2 px-1" style={{ color: COLORS.transfer }}>Transfer</th>
                      <th className="text-right pb-2 px-1" style={{ color: COLORS.other }}>Lainnya</th>
                      <th className="text-right pb-2 px-1 text-slate-400">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {data.by_branch.map(b => (
                      <tr key={b.slug}>
                        <td className="py-2 px-1 text-slate-300 capitalize">{b.name.replace('RedBox ','').replace('Redbox ','')}</td>
                        <td className="py-2 px-1 text-right tabular-nums" style={{ color: COLORS.cash }}>{fmt(b.cash)}</td>
                        <td className="py-2 px-1 text-right tabular-nums" style={{ color: COLORS.qris }}>{fmt(b.qris)}</td>
                        <td className="py-2 px-1 text-right tabular-nums" style={{ color: COLORS.transfer }}>{fmt(b.transfer)}</td>
                        <td className="py-2 px-1 text-right tabular-nums" style={{ color: COLORS.other }}>{fmt(b.other)}</td>
                        <td className="py-2 px-1 text-right tabular-nums text-slate-300 font-semibold">{fmt(b.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
