import { useMemo, useState, useEffect } from 'react';
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
import {
  computePerformanceSummary,
  computeDailySummary,
  getMonthlyDailyPerformance,
  fillMissingDailyPoints,
  type MonthlyPerformancePoint,
  type DailyPerformancePoint,
} from '../services/performance';

const REDBOX_RED = '#C72820';
const GREEN = '#2F8F53';
const MUTED = '#8A8479';

const FULL_MONTH_NAMES: Record<string, string> = {
  Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April',
  May: 'May', Jun: 'June', Jul: 'July', Aug: 'August',
  Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December',
};
const MONTH_NUM_TO_LABEL: Record<number, string> = {
  1: 'Jan', 2: 'Feb', 3: 'Mar', 4: 'Apr',
  5: 'May', 6: 'Jun', 7: 'Jul', 8: 'Aug',
  9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dec',
};

function formatJuta(value: number): string {
  return `${Math.round(value / 1_000_000).toLocaleString('id-ID')}jt`;
}

function formatMiliar(value: number): string {
  return `Rp ${(value / 1_000_000_000).toFixed(2).replace('.', ',')} Miliar`;
}

function formatRupiahFull(value: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

/** Rounds a maximum value up to a clean tick ceiling (nearest 50jt) so the Y axis reads as round numbers. */
function niceMax(maxValue: number): number {
  const step = 50_000_000;
  return Math.ceil((maxValue || step) / step) * step;
}

// ── Year-view tooltip ─────────────────────────────────────────────────────────
interface YearChartPoint extends MonthlyPerformancePoint {
  prevNetSales: number | null;
  prevMonthLabel: string | null;
}

function YearTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as YearChartPoint;
  if (point.net_sales === null) return null;

  const momPct = point.prevNetSales ? ((point.net_sales - point.prevNetSales) / point.prevNetSales) * 100 : null;
  const monthTitle = `${FULL_MONTH_NAMES[point.month_label] || point.month_label} 2026`;
  const prevMonthName = point.prevMonthLabel ? (FULL_MONTH_NAMES[point.prevMonthLabel] || point.prevMonthLabel) : 'bulan lalu';

  return (
    <div className="rounded-xl border border-rb-border bg-rb-surface px-3.5 py-3 shadow-[0_4px_24px_rgba(30,25,20,0.12)]" data-testid="chart-tooltip">
      <div className="mb-1.5 text-xs font-semibold text-rb-text">{monthTitle}</div>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-rb-text-muted">Net Sales</span>
        <span className="font-semibold text-rb-text">{formatRupiahFull(point.net_sales)}</span>
      </div>
      {point.transaction_count !== null && (
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-rb-text-muted">Transactions</span>
          <span className="font-semibold text-rb-text">{point.transaction_count.toLocaleString('id-ID')}</span>
        </div>
      )}
      {momPct !== null && (
        <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-rb-divider pt-1 text-xs">
          <span className="text-rb-text-muted">vs {prevMonthName}</span>
          <span className="font-semibold" style={{ color: momPct >= 0 ? GREEN : REDBOX_RED }}>
            {momPct >= 0 ? '+' : ''}{momPct.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}

// ── Month-view tooltip ────────────────────────────────────────────────────────
interface DayChartPoint extends DailyPerformancePoint {
  prevNetSales: number | null;
  prevDay: number | null;
}

export function DailyPerformanceTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as DayChartPoint;
  if (point.net_sales === null) return null;

  const [year, monthNum, day] = point.date.split('-').map(Number);
  const monthName = FULL_MONTH_NAMES[MONTH_NUM_TO_LABEL[monthNum]] || MONTH_NUM_TO_LABEL[monthNum];
  const dateTitle = `${day} ${monthName} ${year}`;
  const dayPct = (point.prevNetSales && point.net_sales !== null)
    ? ((point.net_sales - point.prevNetSales) / point.prevNetSales) * 100
    : null;

  return (
    <div className="rounded-xl border border-rb-border bg-rb-surface px-3.5 py-3 shadow-[0_4px_24px_rgba(30,25,20,0.12)]" data-testid="day-tooltip">
      <div className="mb-1.5 text-xs font-semibold text-rb-text">{dateTitle}</div>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-rb-text-muted">Net Sales</span>
        <span className="font-semibold text-rb-text">{formatRupiahFull(point.net_sales)}</span>
      </div>
      {point.transaction_count !== null && (
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-rb-text-muted">Transactions</span>
          <span className="font-semibold text-rb-text">{point.transaction_count.toLocaleString('id-ID')}</span>
        </div>
      )}
      {dayPct !== null && point.prevDay !== null && (
        <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-rb-divider pt-1 text-xs">
          <span className="text-rb-text-muted">vs day {point.prevDay}</span>
          <span className="font-semibold" style={{ color: dayPct >= 0 ? GREEN : REDBOX_RED }}>
            {dayPct >= 0 ? '+' : ''}{dayPct.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}

// ── KPI chip ──────────────────────────────────────────────────────────────────
function KpiChip({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="text-right">
      <div className="text-[10.5px] font-semibold text-rb-text-muted">{label}</div>
      <div className="font-serif text-sm font-semibold text-rb-text" data-testid={testId}>{value}</div>
    </div>
  );
}

function ColoredKpi({ label, value, isPositive, testId }: { label: string; value: string; isPositive: boolean; testId?: string }) {
  return (
    <div className="text-right">
      <div className="text-[10.5px] font-semibold text-rb-text-muted">{label}</div>
      <div className="font-serif text-sm font-semibold" style={{ color: value === '—' ? MUTED : isPositive ? GREEN : REDBOX_RED }} data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

// ── Toggle button ─────────────────────────────────────────────────────────────
function ViewToggle({ view, onChange }: { view: 'year' | 'month'; onChange: (v: 'year' | 'month') => void }) {
  const base = 'px-3 py-1 text-xs font-semibold rounded-lg transition-all duration-200';
  const active = `${base} bg-rb-red text-white`;
  const inactive = `${base} text-rb-text-muted hover:bg-rb-divider`;
  return (
    <div className="flex items-center gap-1 rounded-xl border border-rb-border bg-rb-bg p-0.5" data-testid="view-toggle">
      <button type="button" aria-pressed={view === 'year'} className={view === 'year' ? active : inactive} onClick={() => onChange('year')} data-testid="view-year">
        Year
      </button>
      <button type="button" aria-pressed={view === 'month'} className={view === 'month' ? active : inactive} onClick={() => onChange('month')} data-testid="view-month">
        Month
      </button>
    </div>
  );
}

// ── Month selector ────────────────────────────────────────────────────────────
function MonthSelector({ selected, available, onChange }: { selected: number; available: number[]; onChange: (m: number) => void }) {
  return (
    <select
      className="rounded-lg border border-rb-border bg-rb-bg px-2.5 py-1 text-xs font-semibold text-rb-text focus:outline-none focus:ring-2 focus:ring-rb-red/20"
      value={selected}
      aria-label="Month"
      onChange={(e) => onChange(Number(e.target.value))}
      data-testid="month-selector"
    >
      {available.map((m) => (
        <option key={m} value={m}>
          {FULL_MONTH_NAMES[MONTH_NUM_TO_LABEL[m]]} 2026
        </option>
      ))}
    </select>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export interface BusinessPerformanceChartProps {
  data: MonthlyPerformancePoint[];
  branch?: string;
}

export function YearlyPerformanceChart({ data, branch = 'all' }: BusinessPerformanceChartProps) {
  const [view, setView] = useState<'year' | 'month'>('year');
  const availableMonths = useMemo(() => data.filter(point => point.net_sales !== null).map(point => point.month), [data]);
  const [selectedMonth, setSelectedMonth] = useState<number>(() => availableMonths.at(-1) ?? 8);

  useEffect(() => {
    if (availableMonths.length > 0 && !availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths.at(-1) ?? 8);
    }
  }, [availableMonths, selectedMonth]);

  // Daily data state
  const [dailyData, setDailyData] = useState<DailyPerformancePoint[]>([]);
  const [prevMonthDailyData, setPrevMonthDailyData] = useState<DailyPerformancePoint[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);

  // Load daily data when month view is active or branch/month changes
  useEffect(() => {
    if (view !== 'month') return;
    let cancelled = false;
    setDailyLoading(true);
    Promise.all([
      getMonthlyDailyPerformance({ branch, year: 2026, month: selectedMonth }),
      selectedMonth > 1
        ? getMonthlyDailyPerformance({ branch, year: 2026, month: selectedMonth - 1 })
        : Promise.resolve([]),
    ]).then(([curr, prev]) => {
      if (cancelled) return;
      setDailyData(fillMissingDailyPoints(curr, 2026, selectedMonth));
      setPrevMonthDailyData(selectedMonth > 1
        ? fillMissingDailyPoints(prev, 2026, selectedMonth - 1)
        : []);
    }).catch(() => {
      if (!cancelled) {
        setDailyData([]);
        setPrevMonthDailyData([]);
      }
    }).finally(() => {
      if (!cancelled) setDailyLoading(false);
    });
    return () => { cancelled = true; };
  }, [view, branch, selectedMonth]);

  // ── Year view data ────────────────────────────────────────────────────────
  const yearChartData = useMemo(() => {
    let prevNetSales: number | null = null;
    let prevMonthLabel: string | null = null;
    return data.map((point) => {
      const withPrev = { ...point, prevNetSales, prevMonthLabel };
      if (point.net_sales !== null) {
        prevNetSales = point.net_sales;
        prevMonthLabel = point.month_label;
      }
      return withPrev;
    });
  }, [data]);

  const summary = useMemo(() => computePerformanceSummary(data), [data]);
  const actualYearPoints = useMemo(() => data.filter((p) => p.net_sales !== null), [data]);
  const yearAxisMax = useMemo(() => niceMax(Math.max(0, ...actualYearPoints.map((p) => p.net_sales ?? 0))), [actualYearPoints]);

  // Handle click on year chart point → switch to month view
  const handleMonthPointClick = (point: MonthlyPerformancePoint) => {
    if (point.net_sales === null) return;
    setSelectedMonth(point.month);
    setView('month');
  };

  // ── Month view data ───────────────────────────────────────────────────────
  const dayChartData = useMemo(() => dailyData.map((point, index) => {
    const previousCalendarDay = index > 0 ? dailyData[index - 1] : null;
    const hasPreviousDay = previousCalendarDay?.net_sales !== null
      && previousCalendarDay?.net_sales !== undefined;
    return {
      ...point,
      prevNetSales: hasPreviousDay ? previousCalendarDay.net_sales : null,
      prevDay: hasPreviousDay ? previousCalendarDay.day : null,
    };
  }), [dailyData]);

  const jakartaNow = new Date(Date.now() + (7 * 60 * 60 * 1000));
  const isCurrentMonth = jakartaNow.getUTCFullYear() === 2026 && jakartaNow.getUTCMonth() + 1 === selectedMonth;
  const dailySummary = useMemo(
    () => computeDailySummary(dailyData, prevMonthDailyData, isCurrentMonth),
    [dailyData, prevMonthDailyData, isCurrentMonth],
  );
  const dayAxisMax = useMemo(
    () => niceMax(Math.max(0, ...dailyData.map((p) => p.net_sales ?? 0))),
    [dailyData],
  );

  const selectedMonthLabel = FULL_MONTH_NAMES[MONTH_NUM_TO_LABEL[selectedMonth]] ?? MONTH_NUM_TO_LABEL[selectedMonth];
  const prevMonthLabel = selectedMonth > 1
    ? (FULL_MONTH_NAMES[MONTH_NUM_TO_LABEL[selectedMonth - 1]] ?? MONTH_NUM_TO_LABEL[selectedMonth - 1])
    : null;

  return (
    <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5" data-testid="yearly-performance-card">
      {/* ── Header row ── */}
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-[17px] font-semibold text-rb-text" data-testid="yearly-performance-title">
            Business Performance
          </h2>
          <p className="mt-0.5 text-xs text-rb-text-muted">Net Sales Redbox sepanjang 2026</p>
        </div>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {/* ── Year view ── */}
      {view === 'year' && (
        <>
          {/* KPI row */}
          {summary && (
            <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1">
              <div className="flex-1" />
              <KpiChip
                label="2026 YTD Net Sales"
                value={formatMiliar(summary.ytd)}
                testId="ytd-net-sales"
              />
              <KpiChip
                label="Average Net Sales / Month"
                value={formatJuta(summary.avg)}
                testId="avg-net-sales"
              />
              <KpiChip
                label="Best Month"
                value={`${summary.best.month_label} — ${formatJuta(summary.best.net_sales ?? 0)}`}
                testId="best-month"
              />
              <ColoredKpi
                label="Latest MoM"
                value={summary.latestMoM ? summary.latestMoM.formatted : '—'}
                isPositive={summary.latestMoM?.isPositive ?? true}
                testId="latest-mom"
              />
            </div>
          )}

          {/* Area chart */}
          {actualYearPoints.length === 0 ? (
            <p className="py-10 text-center text-sm text-rb-text-muted">Belum ada data performa tahunan.</p>
          ) : (
            <div className="h-[220px] w-full" data-testid="year-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={yearChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="yearlyPerformanceFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={REDBOX_RED} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={REDBOX_RED} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#F2EEE3" strokeDasharray="0" />
                  <XAxis dataKey="month_label" axisLine={false} tickLine={false} tick={{ fill: MUTED, fontSize: 11 }} dy={8} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: MUTED, fontSize: 11 }} width={44} domain={[0, yearAxisMax]} tickFormatter={(v: number) => formatJuta(v)} />
                  <Tooltip content={YearTooltip} cursor={{ stroke: '#EBE7DC', strokeWidth: 1 }} />
                  <Area
                    type="monotone"
                    dataKey="net_sales"
                    stroke={REDBOX_RED}
                    strokeWidth={2.5}
                    fill="url(#yearlyPerformanceFill)"
                    dot={(props) => {
                      const point = props.payload as MonthlyPerformancePoint;
                      if (point.net_sales === null) return <g />;
                      return (
                        <g
                          className="cursor-pointer"
                          aria-hidden="true"
                          data-testid={`year-point-${point.month}`}
                          onClick={() => handleMonthPointClick(point)}
                        >
                          <circle cx={props.cx} cy={props.cy} r={12} fill="transparent" />
                          <circle cx={props.cx} cy={props.cy} r={3} fill={REDBOX_RED} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
                        </g>
                      );
                    }}
                    activeDot={{ r: 4, fill: REDBOX_RED, stroke: '#fff', strokeWidth: 2 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
              <div className="sr-only" aria-label="Monthly performance drilldown controls">
                {actualYearPoints.map((point) => (
                  <button type="button" key={point.month} onClick={() => handleMonthPointClick(point)}>
                    Open {FULL_MONTH_NAMES[point.month_label] || point.month_label} 2026 daily performance
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="mt-3 text-[11.5px] text-rb-text-faint">
            Database live diprioritaskan; data statis Januari–Agustus dipakai hanya bila data database belum tersedia.
          </p>
        </>
      )}

      {/* ── Month view ── */}
      {view === 'month' && (
        <>
          {/* Month selector + KPIs */}
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <MonthSelector selected={selectedMonth} available={availableMonths} onChange={setSelectedMonth} />
            {dailySummary && !dailyLoading && (
              <div className="ml-auto flex flex-wrap gap-x-6 gap-y-1">
                <KpiChip
                  label={isCurrentMonth ? 'Total MTD' : 'Total Month'}
                  value={formatRupiahFull(dailySummary.total)}
                  testId="daily-total"
                />
                <KpiChip
                  label={isCurrentMonth ? 'Average / Active Day' : 'Average / Day'}
                  value={formatRupiahFull(dailySummary.avgPerDay)}
                  testId="daily-avg"
                />
                <KpiChip
                  label="Best Day"
                  value={`${dailySummary.bestDay.day} ${selectedMonthLabel.slice(0, 3)} — ${formatRupiahFull(dailySummary.bestDay.net_sales ?? 0)}`}
                  testId="best-day"
                />
                <ColoredKpi
                  label={prevMonthLabel ? `${isCurrentMonth ? 'MTD' : 'Month'} vs ${prevMonthLabel}${isCurrentMonth ? ' MTD' : ''}` : 'vs Prev Month'}
                  value={dailySummary.vsLastMonth ? dailySummary.vsLastMonth.formatted : '—'}
                  isPositive={dailySummary.vsLastMonth?.isPositive ?? true}
                  testId="vs-prev-month"
                />
              </div>
            )}
          </div>

          {/* Daily area chart */}
          {dailyLoading ? (
            <div className="flex h-[220px] items-center justify-center text-sm text-rb-text-muted" data-testid="daily-loading">
              Memuat data…
            </div>
          ) : !dailySummary ? (
            <p className="py-10 text-center text-sm text-rb-text-muted" data-testid="daily-empty">
              Belum ada data harian untuk {selectedMonthLabel} 2026.
            </p>
          ) : (
            <div className="h-[220px] w-full" data-testid="month-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dayChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dailyPerformanceFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={REDBOX_RED} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={REDBOX_RED} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#F2EEE3" strokeDasharray="0" />
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: MUTED, fontSize: 10 }}
                    dy={8}
                    tickFormatter={(v: number) => String(v)}
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: MUTED, fontSize: 11 }} width={44} domain={[0, dayAxisMax]} tickFormatter={(v: number) => formatJuta(v)} />
                  <Tooltip content={DailyPerformanceTooltip} cursor={{ stroke: '#EBE7DC', strokeWidth: 1 }} />
                  <Area
                    type="monotone"
                    dataKey="net_sales"
                    stroke={REDBOX_RED}
                    strokeWidth={2}
                    fill="url(#dailyPerformanceFill)"
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
            Data aktual {selectedMonthLabel} 2026 dari Moka POS.
          </p>
        </>
      )}
    </div>
  );
}
