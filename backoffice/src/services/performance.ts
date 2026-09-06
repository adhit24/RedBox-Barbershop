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
