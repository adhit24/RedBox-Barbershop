import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  type TooltipContentProps,
} from 'recharts';
import type { MonthlyPerformancePoint } from '../services/performance';

const REDBOX_RED = '#C72820';

function formatJuta(value: number): string {
  return `${Math.round(value / 1_000_000).toLocaleString('id-ID')}jt`;
}

function formatMiliar(value: number): string {
  return `Rp ${(value / 1_000_000_000).toFixed(2).replace('.', ',')} Miliar`;
}

function formatRupiahFull(value: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

/** Rounds a maximum value up to a clean tick ceiling (nearest 50jt) so the Y axis reads as round numbers, without forcing any fixed range — it adapts to whatever the real data is. */
function niceMax(maxValue: number): number {
  const step = 50_000_000;
  return Math.ceil((maxValue || step) / step) * step;
}

interface ChartTooltipPayloadPoint extends MonthlyPerformancePoint {
  prevNetSales: number | null;
}

function ChartTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as ChartTooltipPayloadPoint;
  if (point.net_sales === null) return null;

  const momPct = point.prevNetSales ? ((point.net_sales - point.prevNetSales) / point.prevNetSales) * 100 : null;

  return (
    <div className="rounded-xl border border-rb-border bg-rb-surface px-3.5 py-3 shadow-[0_4px_24px_rgba(30,25,20,0.12)]">
      <div className="mb-1.5 text-xs font-semibold text-rb-text">{point.month_label} 2026</div>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-rb-text-muted">Net Sales</span>
        <span className="font-semibold text-rb-text">{formatRupiahFull(point.net_sales)}</span>
      </div>
      {point.transaction_count !== null && (
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-rb-text-muted">Transaksi</span>
          <span className="font-semibold text-rb-text">{point.transaction_count.toLocaleString('id-ID')}</span>
        </div>
      )}
      {momPct !== null && (
        <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-rb-divider pt-1 text-xs">
          <span className="text-rb-text-muted">vs bulan lalu</span>
          <span className="font-semibold" style={{ color: momPct >= 0 ? '#2F8F53' : REDBOX_RED }}>
            {momPct >= 0 ? '+' : ''}{momPct.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}

export function YearlyPerformanceChart({ data }: { data: MonthlyPerformancePoint[] }) {
  const chartData = useMemo(() => {
    let prevNetSales: number | null = null;
    return data.map((point) => {
      const withPrev = { ...point, prevNetSales };
      if (point.net_sales !== null) prevNetSales = point.net_sales;
      return withPrev;
    });
  }, [data]);

  const actualPoints = useMemo(() => data.filter((p) => p.net_sales !== null), [data]);

  const summary = useMemo(() => {
    if (actualPoints.length === 0) return null;
    const ytd = actualPoints.reduce((sum, p) => sum + (p.net_sales ?? 0), 0);
    const avg = ytd / actualPoints.length;
    const best = actualPoints.reduce((a, b) => ((b.net_sales ?? 0) > (a.net_sales ?? 0) ? b : a));
    return { ytd, avg, best };
  }, [actualPoints]);

  const yAxisMax = useMemo(() => niceMax(Math.max(0, ...actualPoints.map((p) => p.net_sales ?? 0))), [actualPoints]);

  return (
    <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-[17px] font-semibold text-rb-text">Performance by Year</h2>
          <p className="mt-0.5 text-xs text-rb-text-muted">Performa bulanan Redbox sepanjang 2026</p>
        </div>
        {summary && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-right">
            <div>
              <div className="text-[10.5px] font-semibold text-rb-text-muted">2026 YTD Net Sales</div>
              <div className="font-serif text-sm font-semibold text-rb-text">{formatMiliar(summary.ytd)}</div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold text-rb-text-muted">Avg / Bulan</div>
              <div className="font-serif text-sm font-semibold text-rb-text">{formatJuta(summary.avg)}</div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold text-rb-text-muted">Bulan Terbaik</div>
              <div className="font-serif text-sm font-semibold text-rb-text">{summary.best.month_label} — {formatJuta(summary.best.net_sales ?? 0)}</div>
            </div>
          </div>
        )}
      </div>

      {actualPoints.length === 0 ? (
        <p className="py-10 text-center text-sm text-rb-text-muted">Belum ada data performa tahunan.</p>
      ) : (
        <div className="mt-3 h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="yearlyPerformanceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={REDBOX_RED} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={REDBOX_RED} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#F2EEE3" strokeDasharray="0" />
              <XAxis
                dataKey="month_label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#8A8479', fontSize: 11 }}
                dy={8}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#8A8479', fontSize: 11 }}
                width={44}
                domain={[0, yAxisMax]}
                tickFormatter={(v: number) => formatJuta(v)}
              />
              <Tooltip content={ChartTooltip} cursor={{ stroke: '#EBE7DC', strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="net_sales"
                stroke={REDBOX_RED}
                strokeWidth={2.5}
                fill="url(#yearlyPerformanceFill)"
                dot={false}
                activeDot={{ r: 4, fill: REDBOX_RED, stroke: '#fff', strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-3 text-[11.5px] text-rb-text-faint">
        Data aktual Januari–Agustus 2026 dari Moka POS. September–Desember belum tersedia.
      </p>
    </div>
  );
}
