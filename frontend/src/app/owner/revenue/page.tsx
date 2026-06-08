'use client';
import { useEffect, useState, useCallback } from 'react';
import { fetchOwnerRevenue, fetchPaymentAnalytics } from '@/lib/adminCrmApi';
import type { OwnerRevenueData, PaymentAnalyticsData, PaymentMethodStat } from '@/lib/adminCrmTypes';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Scissors, ShoppingBag, Upload, CheckCircle2, XCircle, CreditCard } from 'lucide-react';
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

const PAYMENT_COLORS: Record<string, string> = {
  cash: '#3b82f6', qris: '#8b5cf6', transfer: '#14b8a6', other: '#f59e0b',
};

function PaymentCard({
  method, isActive, onClick,
}: {
  method: PaymentMethodStat;
  isActive: boolean;
  onClick: () => void;
}) {
  const color = PAYMENT_COLORS[method.key] ?? '#64748b';
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className="relative w-full text-left rounded-2xl px-4 py-3 overflow-hidden cursor-pointer min-h-[72px]"
      style={{
        background: isActive ? 'rgba(255,255,255,0.06)' : '#0F172A',
        border: `1px solid ${isActive ? color + '55' : '#1e293b'}`,
        borderTop: `2px solid ${color}`,
      }}
    >
      <p className="text-[9px] uppercase tracking-widest font-semibold mb-1" style={{ color: '#64748b' }}>
        {method.name}
      </p>
      <p className="text-base font-bold tabular-nums" style={{ color }}>
        Rp {method.total >= 1_000_000
          ? `${(method.total / 1_000_000).toFixed(1)}jt`
          : method.total >= 1_000
          ? `${(method.total / 1_000).toFixed(0)}rb`
          : String(method.total)}
      </p>
      <p className="text-[10px] mt-0.5" style={{ color: '#475569' }}>
        {method.tx_count} tx · {method.pct}%
      </p>
    </motion.button>
  );
}

function PaymentMethodSheet({
  method, data, periodLabel, onClose,
}: {
  method: PaymentMethodStat;
  data: PaymentAnalyticsData;
  periodLabel: string;
  onClose: () => void;
}) {
  const color  = PAYMENT_COLORS[method.key] ?? '#64748b';
  const key    = method.key as 'cash' | 'qris' | 'transfer' | 'other';
  const trend  = data.daily_trend.map(d => ({ date: d.date.slice(5), value: d[key] }));

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-40 bg-black/60"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      {/* Sheet */}
      <motion.div
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl px-4 py-5 max-w-lg mx-auto"
        style={{ background: '#0d1117', borderTop: `2px solid ${color}33` }}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ ease: [0.32, 0.72, 0, 1], duration: 0.35 }}
      >
        {/* Handle */}
        <div className="w-8 h-1 rounded-full bg-slate-700 mx-auto mb-4" />

        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500">Detail Pembayaran</p>
            <p className="text-sm font-bold text-white">{method.name} · {periodLabel}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 text-xl leading-none px-2 cursor-pointer">×</button>
        </div>

        {/* Trend chart */}
        {trend.length > 1 && (
          <div className="mb-5">
            <p className="text-[9px] uppercase tracking-widest text-slate-600 mb-2">Tren Harian</p>
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={trend} barSize={6}>
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#475569' }} />
                <YAxis hide />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => [`Rp ${Math.round((Number(v) || 0) / 1000)}rb`, method.name]}
                  contentStyle={{ background: '#0F172A', border: `1px solid ${color}44`, borderRadius: 8, fontSize: 11 }}
                />
                <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Per branch */}
        <div>
          <p className="text-[9px] uppercase tracking-widest text-slate-600 mb-2">Per Cabang</p>
          <div className="space-y-2">
            {data.by_branch
              .filter(b => b[key] > 0)
              .sort((a, b) => b[key] - a[key])
              .map(b => (
                <div key={b.slug} className="flex justify-between items-center bg-[#0a0f1a] rounded-xl px-3 py-2.5">
                  <span className="text-[12px] text-slate-300 capitalize">
                    {b.name.replace('RedBox ', '').replace('Redbox ', '')}
                  </span>
                  <span className="text-[13px] font-bold tabular-nums" style={{ color }}>
                    Rp {b[key] >= 1_000_000
                      ? `${(b[key] / 1_000_000).toFixed(1)}jt`
                      : `${Math.round(b[key] / 1_000)}rb`}
                  </span>
                </div>
              ))}
          </div>
        </div>

        {/* Safe area bottom */}
        <div className="h-[env(safe-area-inset-bottom,16px)]" />
      </motion.div>
    </>
  );
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0F172A] border border-slate-700 rounded-xl px-3 py-2 text-xs">
      <p className="text-slate-400 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name === 'moka' ? 'Moka' : 'Web'}: Rp {fmt(p.value)}
        </p>
      ))}
    </div>
  );
};

type ImportResult = { ok: boolean; transactions?: number; barber_services?: number; skipped?: number; error?: string };

export default function OwnerRevenuePage() {
  const [branch, setBranch] = useState('all');
  const [period, setPeriod] = useState('7d');
  const [data, setData] = useState<OwnerRevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentData, setPaymentData]     = useState<PaymentAnalyticsData | null>(null);
  const [activePayment, setActivePayment] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, p] = await Promise.all([
      fetchOwnerRevenue(branch, period).catch(() => null),
      fetchPaymentAnalytics(branch, period).catch(() => null),
    ]);
    if (d) setData(d);
    if (p) setPaymentData(p);
    setLoading(false);
  }, [branch, period]);

  useEffect(() => { load(); }, [load]);

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    setImportResult(null);
    try {
      const csvText = await file.text();
      const res = await fetch('/api/admin/crm/import-moka-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText }),
      });
      const result: ImportResult = await res.json();
      setImportResult(result);
      if (result.ok) load();
    } catch {
      setImportResult({ ok: false, error: 'Gagal upload' });
    } finally {
      setImporting(false);
    }
  }

  const maxBranchRev = data ? Math.max(...data.branch_compare.map(b => b.revenue_moka + b.revenue_web), 1) : 1;

  return (
    <div className="p-4 space-y-4 pb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-slate-500" />
          <h2 className="text-white font-bold text-base">Revenue</h2>
        </div>
        <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
          importing ? 'opacity-50 pointer-events-none' : 'bg-slate-900 text-slate-300 border-slate-700 active:scale-95'
        }`}>
          <Upload size={12} />
          {importing ? 'Mengimpor...' : 'Import CSV'}
          <input type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} disabled={importing} />
        </label>
      </div>

      {/* Import result toast */}
      <AnimatePresence>
        {importResult && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs border ${
              importResult.ok
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
            onClick={() => setImportResult(null)}
          >
            {importResult.ok
              ? <CheckCircle2 size={14} />
              : <XCircle size={14} />}
            {importResult.ok
              ? `Import berhasil — ${importResult.transactions} transaksi, ${importResult.barber_services} baris kapster`
              : `Gagal: ${importResult.error}`}
          </motion.div>
        )}
      </AnimatePresence>

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
          <Skeleton className="h-20" />
          <Skeleton className="h-48" />
          <Skeleton className="h-32" />
        </div>
      ) : !data ? (
        <p className="text-center text-slate-500 text-sm py-12">Gagal memuat</p>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={`${branch}-${period}`}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-4">

            {/* Summary */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Moka',     value: `Rp ${fmt(data.summary.revenue_moka)}`, color: 'text-teal-400' },
                { label: 'Web',      value: `Rp ${fmt(data.summary.revenue_web)}`,  color: 'text-blue-400' },
                { label: 'Total Tx', value: String(data.summary.tx_total),           color: 'text-slate-300' },
                { label: 'Avg Tx',   value: `Rp ${fmt(data.summary.avg_tx)}`,        color: 'text-green-400' },
              ].map((s, i) => (
                <motion.div key={s.label}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-[#0F172A] border border-slate-800 rounded-2xl px-3 py-2.5">
                  <p className={`text-lg font-bold tabular-nums ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-slate-500">{s.label}</p>
                </motion.div>
              ))}
            </div>

            {/* Daily trend chart */}
            {data.daily_trend.length > 1 && (
              <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Tren Harian</p>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={data.daily_trend} barSize={8} barGap={2}>
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }} tickFormatter={(d: string) => d.slice(5)} />
                    <YAxis hide />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="moka" fill="#2dd4bf" radius={[4,4,0,0]} />
                    <Bar dataKey="web"  fill="#60a5fa" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex gap-3 mt-2">
                  <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-2.5 h-2.5 rounded-sm bg-teal-400 inline-block"/>Moka</span>
                  <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block"/>Web</span>
                </div>
              </div>
            )}

            {/* Payment Methods */}
            {paymentData && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <CreditCard size={12} className="text-slate-500" />
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Metode Pembayaran</p>
                  </div>
                  <Link href="/owner/payment" className="text-[10px] text-slate-600 underline">
                    Lengkap →
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {paymentData.methods.map(m => (
                    <PaymentCard
                      key={m.key}
                      method={m}
                      isActive={activePayment === m.key}
                      onClick={() => setActivePayment(prev => prev === m.key ? null : m.key)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Branch compare */}
            {branch === 'all' && (
              <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 space-y-2.5">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Perbandingan Cabang</p>
                {data.branch_compare.map((b, i) => {
                  const total = b.revenue_moka + b.revenue_web;
                  const pct = Math.round((total / maxBranchRev) * 100);
                  return (
                    <motion.div key={b.slug}
                      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 }}
                      className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-300 capitalize">{b.name.replace('RedBox ','').replace('Redbox ','')}</span>
                        <span className="text-slate-400 tabular-nums">Rp {fmt(total)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                          transition={{ delay: i * 0.06 + 0.1, duration: 0.5 }}
                          className="h-full bg-gradient-to-r from-teal-500 to-blue-500 rounded-full" />
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* Top Barbers */}
            {data.top_barbers.length > 0 && (
              <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Scissors size={12} className="text-slate-500" />
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Top Kapster</p>
                </div>
                {data.top_barbers.map((b, i) => (
                  <motion.div key={b.barber_id}
                    initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[11px] text-slate-600 w-4 tabular-nums">#{i+1}</span>
                      <div>
                        <p className="text-sm text-slate-200 font-medium">{b.name || b.barber_id}</p>
                        <p className="text-[10px] text-slate-500 capitalize">{b.branch} · {b.tx_count}tx</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-teal-400 tabular-nums">Rp {fmt(b.revenue)}</span>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Top Services */}
            {data.top_services.length > 0 && (
              <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 space-y-2">
                <div className="flex items-center gap-1.5">
                  <ShoppingBag size={12} className="text-slate-500" />
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Top Services</p>
                </div>
                {data.top_services.map((s, i) => (
                  <motion.div key={s.service_name}
                    initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-200 font-medium truncate max-w-[180px]">{s.service_name}</p>
                      <p className="text-[10px] text-slate-500">{s.count}x</p>
                    </div>
                    <span className="text-sm font-bold text-slate-300 tabular-nums">Rp {fmt(s.revenue)}</span>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      <AnimatePresence>
        {activePayment && paymentData && (() => {
          const method = paymentData.methods.find(m => m.key === activePayment);
          if (!method) return null;
          const periodLabel = PERIODS.find(p => p.key === period)?.label ?? period;
          return (
            <PaymentMethodSheet
              method={method}
              data={paymentData}
              periodLabel={periodLabel}
              onClose={() => setActivePayment(null)}
            />
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
