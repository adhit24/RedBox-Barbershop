// Yearly business-performance data for Command Center's Yearly Performance
// Chart. Today this reads the static historical dataset derived from Moka
// CSV exports (see ../data/moka2026Performance.ts for the full methodology
// note). The target production architecture is Moka POS → cron sync →
// Supabase `transactions` → a monthly-aggregation endpoint — at that point
// this function's body changes to an apiClient.get() call, but its
// signature and MonthlyPerformancePoint[] return shape stay the same, so no
// caller (the chart component) needs to change.
import { MOKA_2026_PERFORMANCE, LATEST_ACTUAL_MONTH, type MonthlyPerformancePoint, type BranchScope } from '../data/moka2026Performance';

export type { MonthlyPerformancePoint, BranchScope };
export { LATEST_ACTUAL_MONTH };

function toBranchScope(branch: string): BranchScope {
  return branch === 'all' || branch === 'bypass' || branch === 'csb' || branch === 'samadikun' || branch === 'sumber' || branch === 'tegal'
    ? branch
    : 'all';
}

/** Real monthly Net Sales for the given branch scope (or all branches), Jan–Dec. Months without real data yet have net_sales: null. */
export async function getYearlyPerformance(branch: string): Promise<MonthlyPerformancePoint[]> {
  return MOKA_2026_PERFORMANCE[toBranchScope(branch)];
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
  if (actual.length >= 2) {
    const current = actual[actual.length - 1];
    const prev = actual[actual.length - 2];
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

