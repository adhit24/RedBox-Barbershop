// Historical Moka POS performance, Jan–Aug 2026 — Redbox Barbershop's 5
// outlets only ("Parker Gentlemens Barbershop" excluded; it isn't a Redbox
// branch). Derived once from the real monthly CSV exports in Transaksi/
// (not committed — every row carries a customer phone number, and this repo
// is public) via scripts/analyze-moka-transactions.js. That script documents
// the full methodology: Net Sales is the primary metric because it already
// nets out the 3 refund-correction rows found in the raw data (each a
// negative Net Sales entry); transaction_count and the tooltip's average
// ticket size count Payment rows only, so a refund correction doesn't
// distort "typical sale size."
//
// This file is a stand-in for a real data source, not the production
// architecture. The target architecture (see project notes) is Moka POS →
// cron sync → Supabase `transactions` → a monthly-aggregation query →
// Command Center. getYearlyPerformance() in ../services/performance.ts is
// written so swapping this static module for that endpoint requires no
// change to any component that calls it — see that file.
//
// September–December 2026 have no data yet. They are represented as
// net_sales: null / transaction_count: null, never 0 and never
// interpolated — a chart showing a line dropping to zero would read as a
// business collapse that never happened.

export interface MonthlyPerformancePoint {
  /** 1–12 */
  month: number;
  /** 'Jan'..'Dec' */
  month_label: string;
  /** Rupiah. null = no data yet for this month. */
  net_sales: number | null;
  /** Real Payment-event count for the month. null = no data yet. */
  transaction_count: number | null;
}

export type BranchScope = 'all' | 'bypass' | 'csb' | 'samadikun' | 'sumber' | 'tegal';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function withNoDataMonths(actual: MonthlyPerformancePoint[]): MonthlyPerformancePoint[] {
  const byMonth = new Map(actual.map((p) => [p.month, p]));
  return MONTH_LABELS.map((label, i) => {
    const month = i + 1;
    return byMonth.get(month) ?? { month, month_label: label, net_sales: null, transaction_count: null };
  });
}

const ALL_BRANCHES_ACTUAL: MonthlyPerformancePoint[] = [
  { month: 1, month_label: 'Jan', net_sales: 575788000, transaction_count: 4807 },
  { month: 2, month_label: 'Feb', net_sales: 489705300, transaction_count: 4044 },
  { month: 3, month_label: 'Mar', net_sales: 720683200, transaction_count: 5701 },
  { month: 4, month_label: 'Apr', net_sales: 500736400, transaction_count: 4158 },
  { month: 5, month_label: 'May', net_sales: 589457300, transaction_count: 4921 },
  { month: 6, month_label: 'Jun', net_sales: 549905900, transaction_count: 4441 },
  { month: 7, month_label: 'Jul', net_sales: 578949900, transaction_count: 4812 },
  { month: 8, month_label: 'Aug', net_sales: 583483400, transaction_count: 4644 },
];

const BYPASS_ACTUAL: MonthlyPerformancePoint[] = [
  { month: 1, month_label: 'Jan', net_sales: 109290500, transaction_count: 986 },
  { month: 2, month_label: 'Feb', net_sales: 95615500, transaction_count: 837 },
  { month: 3, month_label: 'Mar', net_sales: 125584500, transaction_count: 1077 },
  { month: 4, month_label: 'Apr', net_sales: 99223700, transaction_count: 914 },
  { month: 5, month_label: 'May', net_sales: 109302500, transaction_count: 1004 },
  { month: 6, month_label: 'Jun', net_sales: 103169000, transaction_count: 925 },
  { month: 7, month_label: 'Jul', net_sales: 110909500, transaction_count: 1001 },
  { month: 8, month_label: 'Aug', net_sales: 114320500, transaction_count: 964 },
];

const CSB_ACTUAL: MonthlyPerformancePoint[] = [
  { month: 1, month_label: 'Jan', net_sales: 257478000, transaction_count: 1685 },
  { month: 2, month_label: 'Feb', net_sales: 216819800, transaction_count: 1425 },
  { month: 3, month_label: 'Mar', net_sales: 325085700, transaction_count: 2068 },
  { month: 4, month_label: 'Apr', net_sales: 230629700, transaction_count: 1465 },
  { month: 5, month_label: 'May', net_sales: 267512300, transaction_count: 1742 },
  { month: 6, month_label: 'Jun', net_sales: 255739900, transaction_count: 1601 },
  { month: 7, month_label: 'Jul', net_sales: 268433900, transaction_count: 1730 },
  { month: 8, month_label: 'Aug', net_sales: 266954900, transaction_count: 1676 },
];

const SAMADIKUN_ACTUAL: MonthlyPerformancePoint[] = [
  { month: 1, month_label: 'Jan', net_sales: 72022500, transaction_count: 663 },
  { month: 2, month_label: 'Feb', net_sales: 65336000, transaction_count: 589 },
  { month: 3, month_label: 'Mar', net_sales: 99442000, transaction_count: 887 },
  { month: 4, month_label: 'Apr', net_sales: 64286500, transaction_count: 615 },
  { month: 5, month_label: 'May', net_sales: 79135500, transaction_count: 718 },
  { month: 6, month_label: 'Jun', net_sales: 75382000, transaction_count: 689 },
  { month: 7, month_label: 'Jul', net_sales: 78190000, transaction_count: 709 },
  { month: 8, month_label: 'Aug', net_sales: 81238500, transaction_count: 703 },
];

const SUMBER_ACTUAL: MonthlyPerformancePoint[] = [
  { month: 1, month_label: 'Jan', net_sales: 62791500, transaction_count: 620 },
  { month: 2, month_label: 'Feb', net_sales: 44656500, transaction_count: 446 },
  { month: 3, month_label: 'Mar', net_sales: 85676000, transaction_count: 787 },
  { month: 4, month_label: 'Apr', net_sales: 49882500, transaction_count: 507 },
  { month: 5, month_label: 'May', net_sales: 64120000, transaction_count: 636 },
  { month: 6, month_label: 'Jun', net_sales: 57147500, transaction_count: 544 },
  { month: 7, month_label: 'Jul', net_sales: 58329500, transaction_count: 589 },
  { month: 8, month_label: 'Aug', net_sales: 60877000, transaction_count: 586 },
];

const TEGAL_ACTUAL: MonthlyPerformancePoint[] = [
  { month: 1, month_label: 'Jan', net_sales: 74205500, transaction_count: 853 },
  { month: 2, month_label: 'Feb', net_sales: 67277500, transaction_count: 747 },
  { month: 3, month_label: 'Mar', net_sales: 84895000, transaction_count: 882 },
  { month: 4, month_label: 'Apr', net_sales: 56714000, transaction_count: 657 },
  { month: 5, month_label: 'May', net_sales: 69387000, transaction_count: 821 },
  { month: 6, month_label: 'Jun', net_sales: 58467500, transaction_count: 682 },
  { month: 7, month_label: 'Jul', net_sales: 63087000, transaction_count: 783 },
  { month: 8, month_label: 'Aug', net_sales: 60092500, transaction_count: 715 },
];

export const MOKA_2026_PERFORMANCE: Record<BranchScope, MonthlyPerformancePoint[]> = {
  all: withNoDataMonths(ALL_BRANCHES_ACTUAL),
  bypass: withNoDataMonths(BYPASS_ACTUAL),
  csb: withNoDataMonths(CSB_ACTUAL),
  samadikun: withNoDataMonths(SAMADIKUN_ACTUAL),
  sumber: withNoDataMonths(SUMBER_ACTUAL),
  tegal: withNoDataMonths(TEGAL_ACTUAL),
};

/** Last calendar month with real data — August (month 8) for this dataset. */
export const LATEST_ACTUAL_MONTH = 8;
