// Yearly business-performance data for Command Center's Yearly Performance
// Chart. Today this reads the static historical dataset derived from Moka
// CSV exports (see ../data/moka2026Performance.ts for the full methodology
// note). The target production architecture is Moka POS → cron sync →
// Supabase `transactions` → a monthly-aggregation endpoint — at that point
// this function's body changes to an apiClient.get() call, but its
// signature and MonthlyPerformancePoint[] return shape stay the same, so no
// caller (the chart component) needs to change.
import { MOKA_2026_PERFORMANCE, LATEST_ACTUAL_MONTH, type MonthlyPerformancePoint, type BranchScope } from '../data/moka2026Performance';
import {
  MOKA_2026_DAILY_PERFORMANCE,
  type DailyPerformancePoint,
  type DailyPerformanceBranch,
} from '../data/moka2026DailyPerformance';
import { apiClient } from '../lib/apiClient';

export type { MonthlyPerformancePoint, BranchScope, DailyPerformancePoint };
export { LATEST_ACTUAL_MONTH };

function toBranchScope(branch: string): BranchScope {
  return branch === 'all' || branch === 'bypass' || branch === 'csb' || branch === 'samadikun' || branch === 'sumber' || branch === 'tegal'
    ? branch
    : 'all';
}

/** Real monthly Net Sales for the given branch scope (or all branches), Jan–Dec. Months without real data yet have net_sales: null. */
export async function getYearlyPerformance(branch: string): Promise<MonthlyPerformancePoint[]> {
  const fallback = MOKA_2026_PERFORMANCE[toBranchScope(branch)];
  try {
    const response = await apiClient.get<{ points: MonthlyPerformancePoint[] }>(
      `/api/admin/business-performance?view=year&year=2026&branch=${encodeURIComponent(toBranchScope(branch))}`,
    );
    if (!response.points?.length) return fallback;
    const liveByMonth = new Map(response.points.map((point) => [point.month, point]));
    return fallback.map((point) => liveByMonth.get(point.month) ?? point);
  } catch {
    return fallback;
  }
}

/**
 * Daily Net Sales for a given branch scope, year, and month.
 * Returns an array of DailyPerformancePoint sorted by day (1–31).
 * Only days with real data are included — no fabricated zeros for missing dates.
 *
 * Service boundary is intentionally async so the signature is compatible with
 * a future apiClient.get() call without changing any caller.
 */
export async function getMonthlyDailyPerformance({
  branch,
  year,
  month,
}: {
  branch: string;
  year: number;
  month: number;
}): Promise<DailyPerformancePoint[]> {
  const scope = toBranchScope(branch) as DailyPerformanceBranch;
  if (month < 1 || month > 12) return [];
  try {
    const response = await apiClient.get<{ points: DailyPerformancePoint[] }>(
      `/api/admin/business-performance?view=month&year=${year}&month=${month}&branch=${encodeURIComponent(scope)}`,
    );
    if (response.points?.length) return response.points;
  } catch {
    // Compatibility fallback intentionally remains limited to audited static history.
  }
  if (year !== 2026 || month > 8) return [];
  return MOKA_2026_DAILY_PERFORMANCE[scope][month] ?? [];
}

/**
 * Materializes every calendar day while preserving missing/future days as null.
 * This keeps the chart honest when a future API returns an incomplete month.
 */
export function fillMissingDailyPoints(
  data: DailyPerformancePoint[],
  year: number,
  month: number,
): DailyPerformancePoint[] {
  const pointByDay = new Map(data.map((point) => [point.day, point]));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    return pointByDay.get(day) ?? {
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day,
      net_sales: null,
      transaction_count: null,
    };
  });
}

export interface PerformanceSummary {
  /** YTD Net Sales in Rupiah (sum of non-null months) */
  ytd: number;
  /** Average Net Sales per month with real data in Rupiah */
  avg: number;
  /** Month with highest Net Sales */
  best: MonthlyPerformancePoint;
  /** Month-over-Month growth between latest 2 available months */
  latestMoM: {
    pct: number;
    formatted: string;
    isPositive: boolean;
    currentMonth: MonthlyPerformancePoint;
    prevMonth: MonthlyPerformancePoint;
  } | null;
  /** Count of actual months with real data */
  actualCount: number;
}

/**
 * Calculates canonical performance summary metrics (YTD, average, best month, latest MoM).
 * Strictly operates on real non-null historical data.
 */
export function computePerformanceSummary(data: MonthlyPerformancePoint[]): PerformanceSummary | null {
  const actual = data.filter((p) => p.net_sales !== null && p.net_sales !== undefined);
  if (actual.length === 0) return null;

  const ytd = actual.reduce((sum, p) => sum + (p.net_sales ?? 0), 0);
  const avg = Math.round(ytd / actual.length);
  const best = actual.reduce((a, b) => ((b.net_sales ?? 0) > (a.net_sales ?? 0) ? b : a));

  let latestMoM: PerformanceSummary['latestMoM'] = null;
  const jakartaNow = new Date(Date.now() + (7 * 60 * 60 * 1000));
  const currentYear = jakartaNow.getUTCFullYear();
  const currentMonth = jakartaNow.getUTCMonth() + 1;
  const completed = currentYear === 2026 ? actual.filter((point) => point.month < currentMonth) : actual;
  if (completed.length >= 2) {
    const current = completed[completed.length - 1];
    const prev = completed[completed.length - 2];
    if (current.net_sales !== null && prev.net_sales !== null && prev.net_sales !== 0) {
      const pct = ((current.net_sales - prev.net_sales) / prev.net_sales) * 100;
      const formatted = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
      latestMoM = {
        pct,
        formatted,
        isPositive: pct >= 0,
        currentMonth: current,
        prevMonth: prev,
      };
    }
  }

  return {
    ytd,
    avg,
    best,
    latestMoM,
    actualCount: actual.length,
  };
}

export interface DailySummary {
  /** Total Net Sales for all real days in the month */
  total: number;
  /** Average Net Sales per day with real data */
  avgPerDay: number;
  /** Day with highest Net Sales */
  bestDay: DailyPerformancePoint;
  /** Month-over-Month comparison vs previous month total (null if no previous month) */
  vsLastMonth: {
    pct: number;
    formatted: string;
    isPositive: boolean;
    prevMonthTotal: number;
  } | null;
  /** Count of days with real data */
  activeDays: number;
}

/**
 * Computes daily-view summary metrics: total, avgPerDay, bestDay, vsLastMonth.
 * prevMonthData may be empty — vsLastMonth will be null in that case.
 */
export function computeDailySummary(
  data: DailyPerformancePoint[],
  prevMonthData?: DailyPerformancePoint[],
  isCurrentMonth = false,
): DailySummary | null {
  const actual = data.filter((p) => p.net_sales !== null);
  if (actual.length === 0) return null;

  const total = actual.reduce((sum, p) => sum + (p.net_sales ?? 0), 0);
  const avgPerDay = Math.round(total / actual.length);
  const bestDay = actual.reduce((a, b) => ((b.net_sales ?? 0) > (a.net_sales ?? 0) ? b : a));

  let vsLastMonth: DailySummary['vsLastMonth'] = null;
  if (prevMonthData && prevMonthData.length > 0) {
    const lastActualDay = Math.max(...actual.map(point => point.day));
    const prevActual = prevMonthData.filter((p) => p.net_sales !== null && (!isCurrentMonth || p.day <= lastActualDay));
    if (prevActual.length > 0) {
      const prevTotal = prevActual.reduce((sum, p) => sum + (p.net_sales ?? 0), 0);
      if (prevTotal > 0) {
        const pct = ((total - prevTotal) / prevTotal) * 100;
        vsLastMonth = {
          pct,
          formatted: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
          isPositive: pct >= 0,
          prevMonthTotal: prevTotal,
        };
      }
    }
  }

  return {
    total,
    avgPerDay,
    bestDay,
    vsLastMonth,
    activeDays: actual.length,
  };
}
