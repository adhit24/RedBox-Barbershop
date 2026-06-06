'use client';
import { useEffect, useState, useCallback } from 'react';
import { fetchOwnerRevenue } from '@/lib/adminCrmApi';
import type { OwnerRevenueData } from '@/lib/adminCrmTypes';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Scissors, ShoppingBag, Upload, CheckCircle2, XCircle } from 'lucide-react';

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
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchOwnerRevenue(branch, period).catch(() => null);
    if (d) setData(d);
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
    </div>
  );
}
