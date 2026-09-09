import { useState, useEffect, useCallback } from 'react';
import {
  getStockistBackofficeDashboard,
  getStockistMovementChart,
  type StockistBackofficeData,
  type StockistMovementChartData,
} from '../services/stockist';

export function StockistDashboard() {
  const [data, setData] = useState<StockistBackofficeData | null>(null);
  const [chartData, setChartData] = useState<StockistMovementChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<number>(7);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getStockistBackofficeDashboard();
      setData(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Data inventory belum dapat dimuat.';
      setError(msg || 'Data inventory belum dapat dimuat.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChart = useCallback(async (days: number) => {
    setChartLoading(true);
    try {
      const result = await getStockistMovementChart({ days });
      setChartData(result);
    } catch (err) {
      console.warn('[StockistDashboard] chart load failed:', err);
      setChartData(null);
    } finally {
      setChartLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    loadChart(selectedDays);
  }, [selectedDays, loadChart]);

  // If initial load failed, render the honest failure state while keeping the CTA available
  if (error && !data) {
    return (
      <div className="flex flex-col gap-6 pb-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-[28px] font-semibold text-rb-text">Stockist & Inventory</h1>
            <p className="mt-1 text-sm text-rb-text-muted">Monitoring & analitik inventory seluruh cabang Redbox</p>
          </div>
          <a
            href="https://stockist.redboxbarbershop.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-[10px] bg-rb-red px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(199,40,32,0.25)] transition-all hover:bg-rb-red-hover"
          >
            <span>Open Stockist Application ↗</span>
          </a>
        </div>

        <div className="flex flex-col items-center justify-center rounded-[18px] border border-red-200 bg-red-50/50 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-rb-red">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="mt-4 text-base font-bold text-red-900">Data inventory belum dapat dimuat.</h2>
          <p className="mt-1 text-xs text-red-700 max-w-md">
            Terjadi kendala saat menghubungkan ke database Stockist. Operasional toko tetap berjalan normal di aplikasi Stockist.
          </p>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={loadDashboard}
              className="rounded-lg bg-rb-red px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rb-red-hover"
            >
              Coba Lagi
            </button>
            <a
              href="https://stockist.redboxbarbershop.com"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-rb-border bg-white px-4 py-2 text-xs font-semibold text-rb-text hover:bg-slate-50"
            >
              Buka Stockist App ↗
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rb-border bg-rb-surface px-4 py-3 text-xs text-rb-text-muted">
          <div className="flex items-center gap-2">
            <span>💡</span>
            <span>
              <strong>Catatan Akses:</strong> Data Stockist belum bisa diakses dari Backoffice untuk mutasi manual operasional — gunakan aplikasi operasional Stockist untuk eksekusi detail transfer, opname, dan approval stok.
            </span>
          </div>
          <a
            href="https://stockist.redboxbarbershop.com"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-rb-red hover:underline"
          >
            Buka Aplikasi Stockist →
          </a>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading && !data) {
    return (
      <div className="flex flex-col gap-6 pb-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-[28px] font-semibold text-rb-text">Stockist & Inventory</h1>
            <p className="mt-1 text-sm text-rb-text-muted">Monitoring & analitik inventory seluruh cabang Redbox</p>
          </div>
          <a
            href="https://stockist.redboxbarbershop.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-[10px] bg-rb-red px-4 py-2 text-sm font-semibold text-white shadow-sm"
          >
            <span>Open Stockist Application ↗</span>
          </a>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 rounded-[16px] border border-rb-border bg-rb-surface p-5" />
          ))}
        </div>
        <div className="h-14 rounded-[14px] border border-rb-border bg-rb-surface animate-pulse" />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-5 animate-pulse">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 rounded-[16px] border border-rb-border bg-rb-surface" />
          ))}
        </div>
      </div>
    );
  }

  const summary = data?.summary || {
    total_stock: 0,
    active_skus: 0,
    low_stock_count: 0,
    active_transfers_count: 0,
  };

  const branches = data?.branches || [];
  const needsAttention = data?.needs_attention || [];
  const transfers = data?.transfers || [];
  const discrepancyAudits = data?.discrepancy_and_audit || [];
  const chartPoints = chartData?.points || [];
  const chartMax = Math.max(
    50,
    ...chartPoints.map((p) => Math.max(p.masuk, p.keluar, p.terima))
  );

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* ========================================================
          HEADER WITH SYNC PILL & CTA
          ======================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-[28px] font-semibold text-rb-text">Stockist & Inventory</h1>
          <p className="mt-1 text-sm text-rb-text-muted">Monitoring & analitik inventory seluruh cabang Redbox</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Last sync pill with pulsing dot */}
          <div
            className="flex items-center gap-2 rounded-full border border-rb-border bg-rb-surface px-3.5 py-1.5 text-xs font-medium text-rb-text-secondary shadow-sm"
            title={data?.analytics_calc_at ? `Pergerakan harian dihitung: ${data.analytics_calc_at} WIB` : 'Pergerakan harian belum dihitung'}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            <span>
              Inventory live • <strong>{data?.live_sync_at || 'Terhubung'}</strong>
              {data?.analytics_calc_at ? ` • Calc: ${data.analytics_calc_at}` : ' • Daily movement pending'}
            </span>
          </div>

          {/* Primary Red CTA button */}
          <a
            href="https://stockist.redboxbarbershop.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-[10px] bg-rb-red px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(199,40,32,0.25)] transition-all hover:bg-rb-red-hover hover:shadow-[0_6px_20px_rgba(199,40,32,0.35)]"
          >
            <span>Open Stockist Application ↗</span>
          </a>
        </div>
      </div>

      {/* ========================================================
          TOP KPI ROW: 4 ELEGANT SUMMARY CARDS
          ======================================================== */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Stok */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-[16px] border border-rb-border bg-rb-surface p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-500 to-sky-400" />
          <div className="flex items-center justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
            </div>
            <svg className="h-7 w-18" viewBox="0 0 72 28" fill="none">
              <path d="M2 24 L16 18 L32 21 L48 10 L62 14 L70 4" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="mt-3">
            <span className="text-xs font-semibold text-rb-text-muted">Total Stok</span>
            <div className="text-[28px] font-bold text-rb-text">
              {summary.total_stock.toLocaleString('id-ID')} <span className="text-sm font-normal text-rb-text-muted">pcs</span>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-600">
            <span>Live Stockist Balance</span>
          </div>
        </div>

        {/* Card 2: SKU Aktif */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-[16px] border border-rb-border bg-rb-surface p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-teal-500 to-emerald-400" />
          <div className="flex items-center justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M7 8h10M7 12h10M7 16h6" />
              </svg>
            </div>
            <svg className="h-7 w-18" viewBox="0 0 72 28" fill="none">
              <path d="M2 20 L18 22 L34 14 L48 16 L62 8 L70 6" stroke="#0D9488" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="mt-3">
            <span className="text-xs font-semibold text-rb-text-muted">SKU Aktif</span>
            <div className="text-[28px] font-bold text-rb-text">
              {summary.active_skus.toLocaleString('id-ID')}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-600">
            <span>Katalog Aktif Non-F&B</span>
          </div>
        </div>

        {/* Card 3: Stok Menipis */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-[16px] border border-rb-border bg-rb-surface p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-amber-500 to-orange-400" />
          <div className="flex items-center justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <svg className="h-7 w-18" viewBox="0 0 72 28" fill="none">
              <path d="M2 8 L18 12 L34 8 L50 20 L64 16 L70 24" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="mt-3">
            <span className="text-xs font-semibold text-rb-text-muted">Stok Menipis</span>
            <div className={`text-[28px] font-bold ${summary.low_stock_count > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {summary.low_stock_count.toLocaleString('id-ID')}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-rb-text-muted">
            <span>≤ Batas Minimum</span>
          </div>
        </div>

        {/* Card 4: Transfer Berjalan */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-[16px] border border-rb-border bg-rb-surface p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-purple-500 to-indigo-400" />
          <div className="flex items-center justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
                <circle cx="7" cy="18" r="2" />
                <path d="M15 18H9" />
                <circle cx="17" cy="18" r="2" />
                <path d="M14 8h5.6a1 1 0 0 1 .8.4l2.6 3.6h-9" />
                <path d="M18 18h1a2 2 0 0 0 2-2v-3" />
              </svg>
            </div>
            <svg className="h-7 w-18" viewBox="0 0 72 28" fill="none">
              <path d="M2 18 L18 14 L34 19 L48 11 L62 9 L70 5" stroke="#9333EA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="mt-3">
            <span className="text-xs font-semibold text-rb-text-muted">Transfer Berjalan</span>
            <div className="text-[28px] font-bold text-rb-text">
              {summary.active_transfers_count.toLocaleString('id-ID')}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-rb-text-muted">
            <span>Status Sent / In-Transit</span>
          </div>
        </div>
      </div>

      {/* ========================================================
          ALERT BANNER
          ======================================================== */}
      <div
        className={`flex items-center justify-between gap-4 rounded-[14px] border px-5 py-3.5 shadow-sm ${
          data?.alert_banner?.has_issues
            ? 'border-red-200 bg-red-50/80'
            : 'border-emerald-200 bg-emerald-50/80'
        }`}
        role="alert"
      >
        <div className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              data?.alert_banner?.has_issues ? 'bg-red-100 text-rb-red' : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <p className={`text-sm font-medium ${data?.alert_banner?.has_issues ? 'text-red-950' : 'text-emerald-950'}`}>
            {data?.alert_banner?.text || 'Semua cabang dalam kondisi sehat dan stok tercukupi.'}
          </p>
        </div>
        <a
          href="#needs-attention"
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${
            data?.alert_banner?.has_issues
              ? 'border-red-200 bg-white text-rb-red hover:bg-red-50 hover:border-rb-red'
              : 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50'
          }`}
        >
          Tinjau Kebutuhan Restock →
        </a>
      </div>

      {/* ========================================================
          BRANCH HEALTH SECTION ("Kondisi Stok per Cabang")
          ======================================================== */}
      <div>
        <div className="mb-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-rb-text">Kondisi Stok per Cabang</h2>
            <span className="text-xs font-medium text-rb-text-muted">({branches.length} Lokasi Aktif)</span>
          </div>
          <button type="button" className="text-xs font-semibold text-rb-red hover:underline">
            Lihat Semua Cabang →
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {branches.map((b) => {
            const isHealthy = b.status === 'healthy';
            const isOut = b.status === 'out';
            return (
              <div
                key={b.id}
                className="group flex flex-col justify-between rounded-[16px] border border-rb-border bg-rb-surface p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rb-bg text-rb-text-secondary">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                    </div>
                    <span className="text-sm font-bold text-rb-text">{b.name}</span>
                  </div>
                  <span className="text-rb-text-faint transition-transform group-hover:translate-x-1">→</span>
                </div>

                <div className="mt-3 flex items-baseline justify-between">
                  <div className="text-lg font-extrabold text-rb-text">
                    {b.stock.toLocaleString('id-ID')} <span className="text-xs font-normal text-rb-text-muted">pcs</span>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      isHealthy
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : isOut
                        ? 'bg-red-50 text-red-700 border border-red-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}
                  >
                    {b.status_text}
                  </span>
                </div>

                {/* Progress Mini Bar */}
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${
                      isHealthy ? 'bg-emerald-500' : isOut ? 'bg-red-500' : 'bg-amber-500'
                    }`}
                    style={{ width: `${b.capacity_pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ========================================================
          MIDDLE CONTENT SECTION: 2-COLUMN (Needs Attention & Transfer Status)
          ======================================================== */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12" id="needs-attention">
        
        {/* LEFT COLUMN: Needs Attention Table */}
        <div className="rounded-[18px] border border-rb-border bg-rb-surface p-5 shadow-sm lg:col-span-7">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-rb-text">Needs Attention</h3>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                needsAttention.length > 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
              }`}>
                {needsAttention.length} Perlu Tindakan
              </span>
            </div>
            <button type="button" className="text-xs font-semibold text-rb-red hover:underline">
              Lihat Semua →
            </button>
          </div>

          <div className="overflow-x-auto">
            {needsAttention.length === 0 ? (
              <div className="py-8 text-center text-xs text-rb-text-muted">
                ✅ Tidak ada produk di bawah batas minimum stock.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-rb-border bg-slate-50/50 text-rb-text-muted">
                    <th className="py-2.5 px-3 font-semibold">#</th>
                    <th className="py-2.5 px-3 font-semibold">Produk</th>
                    <th className="py-2.5 px-3 font-semibold">Cabang</th>
                    <th className="py-2.5 px-3 font-semibold">Stok</th>
                    <th className="py-2.5 px-3 font-semibold">Minimum</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rb-border/60">
                  {needsAttention.map((prod) => {
                    const isOut = prod.status === 'Out';
                    const isRestock = prod.status === 'Restock';
                    return (
                      <tr key={`${prod.sku}-${prod.branch}-${prod.id}`} className="transition-colors hover:bg-slate-50/60">
                        <td className="py-3 px-3 text-rb-text-muted">{prod.id}</td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2.5">
                            <img
                              src={prod.img}
                              alt={prod.name}
                              className="h-8 w-8 rounded-lg border border-rb-border object-cover"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                            <div>
                              <div className="font-semibold text-rb-text">{prod.name}</div>
                              <div className="text-[10.5px] text-rb-text-muted">{prod.sku}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 font-medium text-rb-text-secondary">{prod.branch}</td>
                        <td className="py-3 px-3 font-bold">
                          <span className={isOut ? 'text-red-600' : isRestock ? 'text-orange-600' : 'text-amber-600'}>
                            {prod.stock}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-rb-text-muted">{prod.min}</td>
                        <td className="py-3 px-3 text-right">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              isOut
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : isRestock
                                ? 'bg-orange-50 text-orange-700 border border-orange-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {prod.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Transfer Status Stacked Cards */}
        <div className="rounded-[18px] border border-rb-border bg-rb-surface p-5 shadow-sm lg:col-span-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-rb-text">Transfer Status</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-rb-text-secondary">Antar Cabang</span>
            </div>
            <button type="button" className="text-xs font-semibold text-rb-red hover:underline">
              Lihat Semua →
            </button>
          </div>

          <div className="flex flex-col gap-2.5">
            {transfers.length === 0 ? (
              <div className="py-8 text-center text-xs text-rb-text-muted">
                Tidak ada riwayat transfer tercatat di Stockist database.
              </div>
            ) : (
              transfers.map((t) => {
                const isSent = t.status === 'Dikirim';
                const isWait = t.status === 'Menunggu Konfirmasi';
                const isRecv = t.status === 'Diterima';

                const bgClass = isSent
                  ? 'bg-blue-50/70 border-blue-200'
                  : isWait
                  ? 'bg-amber-50/70 border-amber-200'
                  : isRecv
                  ? 'bg-emerald-50/70 border-emerald-200'
                  : 'bg-red-50/70 border-red-200';

                const pillClass = isSent
                  ? 'bg-blue-100 text-blue-700'
                  : isWait
                  ? 'bg-amber-100 text-amber-700'
                  : isRecv
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-red-100 text-red-700';

                return (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between rounded-xl border p-3 transition-all hover:translate-x-1 ${bgClass}`}
                  >
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-rb-text">{t.transfer_number}</span>
                        <span className="text-xs font-semibold text-rb-text-secondary">
                          {t.from} <span className="text-rb-text-muted">→</span> {t.to}
                        </span>
                      </div>
                      <span className="mt-0.5 text-[11px] text-rb-text-muted">{t.timestamp}</span>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${pillClass}`}>
                        {t.status}
                      </span>
                      <span className="text-[10.5px] font-semibold text-rb-text-secondary">{t.qty}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* ========================================================
          BOTTOM CONTENT SECTION: 2-COLUMN (Pergerakan Inventory & Discrepancy/Audit)
          ======================================================== */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        
        {/* LEFT: Pergerakan Inventory Bar Chart */}
        <div className="rounded-[18px] border border-rb-border bg-rb-surface p-5 shadow-sm lg:col-span-7">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-bold text-rb-text">Pergerakan Inventory</h3>
            <select
              value={selectedDays}
              onChange={(e) => setSelectedDays(Number(e.target.value))}
              className="rounded-lg border border-rb-border bg-rb-bg px-2.5 py-1 text-xs font-semibold text-rb-text-secondary outline-none"
            >
              <option value={7}>7 Hari Terakhir</option>
              <option value={30}>30 Hari Terakhir</option>
              <option value={90}>90 Hari Terakhir</option>
            </select>
          </div>

          {/* Legend */}
          <div className="mb-4 flex flex-wrap items-center gap-4 text-xs font-semibold text-rb-text-secondary">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-blue-500" />
              <span>Barang Masuk</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-rb-red" />
              <span>Transfer Keluar</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-emerald-500" />
              <span>Penerimaan Cabang</span>
            </div>
          </div>

          {/* Grouped Bar Visualizer or Empty State */}
          <div className="h-52 w-full pt-2">
            {chartLoading ? (
              <div className="flex h-40 items-center justify-center text-xs text-rb-text-muted animate-pulse">
                Memuat data pergerakan...
              </div>
            ) : chartPoints.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center text-center">
                <span className="text-xs font-medium text-rb-text-muted">Data pergerakan inventory belum tersedia.</span>
                <span className="mt-1 text-[11px] text-rb-text-faint">
                  Data pergerakan agregat dihitung setiap hari pukul 00:15 WIB via cron job.
                </span>
              </div>
            ) : (
              <>
                <div
                  className="grid h-40 items-end gap-2 border-b border-rb-border pb-1"
                  style={{ gridTemplateColumns: `repeat(${chartPoints.length}, minmax(0, 1fr))` }}
                >
                  {chartPoints.map((d) => (
                    <div key={d.raw_date} className="group flex h-full flex-col justify-end items-center">
                      <div className="flex w-full items-end justify-center gap-0.5">
                        {/* Masuk */}
                        <div
                          style={{ height: `${Math.max(4, (d.masuk / chartMax) * 100)}%` }}
                          className="w-2 rounded-t bg-blue-500 transition-all group-hover:opacity-85"
                          title={`${d.date} - Masuk: ${d.masuk} pcs`}
                        />
                        {/* Keluar */}
                        <div
                          style={{ height: `${Math.max(4, (d.keluar / chartMax) * 100)}%` }}
                          className="w-2 rounded-t bg-rb-red transition-all group-hover:opacity-85"
                          title={`${d.date} - Keluar: ${d.keluar} pcs`}
                        />
                        {/* Terima */}
                        <div
                          style={{ height: `${Math.max(4, (d.terima / chartMax) * 100)}%` }}
                          className="w-2 rounded-t bg-emerald-500 transition-all group-hover:opacity-85"
                          title={`${d.date} - Terima: ${d.terima} pcs`}
                        />
                      </div>
                      <span className="mt-2 text-[10px] font-medium text-rb-text-muted truncate max-w-full">{d.date}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-rb-text-muted">
                  <span>0 pcs</span>
                  <span>{Math.round(chartMax / 2)} pcs</span>
                  <span>{chartMax} pcs maks</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* RIGHT: Discrepancy & Audit */}
        <div className="rounded-[18px] border border-rb-border bg-rb-surface p-5 shadow-sm lg:col-span-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-rb-text">Discrepancy & Audit</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-rb-text-secondary">
                {discrepancyAudits.length} Temuan Terkini
              </span>
            </div>
            <button type="button" className="text-xs font-semibold text-rb-red hover:underline">
              Lihat Semua →
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {discrepancyAudits.length === 0 ? (
              <div className="py-8 text-center text-xs text-rb-text-muted">
                Tidak ada discrepancy atau penyesuaian stok tercatat.
              </div>
            ) : (
              discrepancyAudits.map((a) => {
                const isDiscrepancy = a.type === 'discrepancy';
                const isAdjustment = a.type === 'adjustment';

                return (
                  <div
                    key={`${a.id}-${a.date}`}
                    className="flex items-start gap-3 rounded-xl border border-rb-border/80 bg-slate-50/40 p-3.5 transition-all hover:bg-white hover:shadow-sm"
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        isDiscrepancy
                          ? 'bg-red-50 text-red-600'
                          : isAdjustment
                          ? 'bg-amber-50 text-amber-600'
                          : 'bg-emerald-50 text-emerald-600'
                      }`}
                    >
                      {isDiscrepancy ? (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                      ) : isAdjustment ? (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-xs text-rb-text">Audit #{a.id}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            isDiscrepancy
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : isAdjustment
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {a.status_text}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-rb-text-secondary">{a.summary}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-rb-text-muted">
                        <span>Cabang {a.branch}</span>
                        <span>•</span>
                        <span>{a.date}</span>
                        <span>•</span>
                        <span>{a.auditor}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* Operational Note for Owner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rb-border bg-rb-surface px-4 py-3 text-xs text-rb-text-muted">
        <div className="flex items-center gap-2">
          <span>💡</span>
          <span>
            <strong>Catatan Akses:</strong> Data Stockist belum bisa diakses dari Backoffice untuk mutasi manual operasional — gunakan aplikasi operasional Stockist untuk eksekusi detail transfer, opname, dan approval stok.
          </span>
        </div>
        <a
          href="https://stockist.redboxbarbershop.com"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-rb-red hover:underline"
        >
          Buka Aplikasi Stockist →
        </a>
      </div>
    </div>
  );
}
