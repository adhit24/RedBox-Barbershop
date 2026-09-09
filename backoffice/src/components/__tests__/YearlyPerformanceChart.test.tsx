import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DailyPerformanceTooltip, YearlyPerformanceChart } from '../YearlyPerformanceChart';
import type { MonthlyPerformancePoint } from '../../services/performance';
import * as performance from '../../services/performance';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const ACTUAL_DATA: MonthlyPerformancePoint[] = [
  { month: 1, month_label: 'Jan', net_sales: 575788000, transaction_count: 4807 },
  { month: 2, month_label: 'Feb', net_sales: 489705300, transaction_count: 4044 },
  { month: 3, month_label: 'Mar', net_sales: 720683200, transaction_count: 5701 },
  { month: 4, month_label: 'Apr', net_sales: 500736400, transaction_count: 4158 },
  { month: 5, month_label: 'May', net_sales: 589457300, transaction_count: 4921 },
  { month: 6, month_label: 'Jun', net_sales: 549905900, transaction_count: 4441 },
  { month: 7, month_label: 'Jul', net_sales: 578949900, transaction_count: 4812 },
  { month: 8, month_label: 'Aug', net_sales: 583483400, transaction_count: 4644 },
  { month: 9, month_label: 'Sep', net_sales: null, transaction_count: null },
  { month: 10, month_label: 'Oct', net_sales: null, transaction_count: null },
  { month: 11, month_label: 'Nov', net_sales: null, transaction_count: null },
  { month: 12, month_label: 'Dec', net_sales: null, transaction_count: null },
];

// Minimal stub August daily data (6 days for speed)
const AUG_DAILY = [
  { date: '2026-08-01', day: 1, net_sales: 25599500, transaction_count: 192 },
  { date: '2026-08-09', day: 9, net_sales: 33608000, transaction_count: 225 },
  { date: '2026-08-17', day: 17, net_sales: 17573500, transaction_count: 147 },
  { date: '2026-08-23', day: 23, net_sales: 22860400, transaction_count: 165 },
  { date: '2026-08-30', day: 30, net_sales: 27717000, transaction_count: 209 },
  { date: '2026-08-31', day: 31, net_sales: 14662500, transaction_count: 126 },
];

const JUL_DAILY = [
  { date: '2026-07-01', day: 1, net_sales: 20000000, transaction_count: 160 },
  { date: '2026-07-15', day: 15, net_sales: 18000000, transaction_count: 145 },
];

// ── 1. Year view remains unchanged ───────────────────────────────────────────
describe('YearlyPerformanceChart — Year view', () => {
  afterEach(() => vi.restoreAllMocks());
  it('1. renders the title and subtitle in year view', () => {
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);
    expect(screen.getByText('Business Performance')).toBeInTheDocument();
    expect(screen.getByText('Net Sales Redbox sepanjang 2026')).toBeInTheDocument();
  });

  it('1. shows Year/Month toggle in year view', () => {
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);
    expect(screen.getByTestId('view-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('view-year')).toBeInTheDocument();
    expect(screen.getByTestId('view-month')).toBeInTheDocument();
  });

  it('1. shows YTD Net Sales in year view', () => {
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);
    expect(screen.getByTestId('ytd-net-sales')).toHaveTextContent('Rp 4,59 Miliar');
  });

  it('1. shows avg per month in year view', () => {
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);
    expect(screen.getByTestId('avg-net-sales')).toHaveTextContent('574jt');
  });

  it('1. shows best month in year view', () => {
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);
    expect(screen.getByTestId('best-month')).toHaveTextContent('Mar — 721jt');
  });

  it('1. shows latest MoM +0.8% in year view', () => {
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);
    expect(screen.getByTestId('latest-mom')).toHaveTextContent('+0.8%');
  });

  it('1. empty state when no year data', () => {
    const nullData = ACTUAL_DATA.map((p) => ({ ...p, net_sales: null, transaction_count: null }));
    render(<YearlyPerformanceChart data={nullData} />);
    expect(screen.getByText('Belum ada data performa tahunan.')).toBeInTheDocument();
  });

  it('1. footer caption is present', () => {
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);
    expect(screen.getByText(/Database live diprioritaskan/)).toBeInTheDocument();
  });
});

// ── 2. Toggle Year → Month ────────────────────────────────────────────────────
describe('YearlyPerformanceChart — View toggle', () => {
  afterEach(() => vi.restoreAllMocks());
  it('2. clicking Month toggle switches to month view', async () => {
    vi.spyOn(performance, 'getMonthlyDailyPerformance').mockResolvedValue(AUG_DAILY);
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);

    fireEvent.click(screen.getByTestId('view-month'));

    await waitFor(() => {
      expect(screen.getByTestId('month-selector')).toBeInTheDocument();
    });
  });

  it('2. clicking Year toggle switches back to year view', async () => {
    vi.spyOn(performance, 'getMonthlyDailyPerformance').mockResolvedValue(AUG_DAILY);
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);

    fireEvent.click(screen.getByTestId('view-month'));
    await waitFor(() => expect(screen.getByTestId('month-selector')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('view-year'));
    expect(screen.getByTestId('ytd-net-sales')).toBeInTheDocument();
    expect(screen.queryByTestId('month-selector')).not.toBeInTheDocument();
  });

  it('3. clicking the August chart point opens August month view', async () => {
    vi.spyOn(performance, 'getMonthlyDailyPerformance').mockResolvedValue(AUG_DAILY);
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open August 2026 daily performance' }));

    await waitFor(() => expect(screen.getByTestId('month-selector')).toHaveValue('8'));
    expect(performance.getMonthlyDailyPerformance).toHaveBeenCalledWith({ branch: 'all', year: 2026, month: 8 });
  });
});

// ── 4. Daily data shown for selected month ────────────────────────────────────
describe('YearlyPerformanceChart — Month view data', () => {
  afterEach(() => vi.restoreAllMocks());
  it('4. shows month view daily KPIs for August', async () => {
    vi.spyOn(performance, 'getMonthlyDailyPerformance').mockResolvedValue(AUG_DAILY);
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);

    fireEvent.click(screen.getByTestId('view-month'));
    await waitFor(() => expect(screen.getByTestId('daily-total')).toBeInTheDocument());
  });

  it('4. empty state when no daily data for selected month', async () => {
    vi.spyOn(performance, 'getMonthlyDailyPerformance').mockResolvedValue([]);
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);

    fireEvent.click(screen.getByTestId('view-month'));
    await waitFor(() => expect(screen.getByTestId('daily-empty')).toBeInTheDocument());
  });

  it('4. requests and displays data only for the selected month', async () => {
    const spy = vi.spyOn(performance, 'getMonthlyDailyPerformance').mockImplementation(async ({ month }) => (
      month === 7 ? JUL_DAILY : AUG_DAILY
    ));
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);

    fireEvent.click(screen.getByTestId('view-month'));
    await waitFor(() => expect(screen.getByTestId('month-selector')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('month-selector'), { target: { value: '7' } });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ branch: 'all', year: 2026, month: 7 }));
    expect(screen.getByTestId('daily-total')).toHaveTextContent(/38\.000\.000/);
  });
});

// ── 5. Branch filter updates daily data ──────────────────────────────────────
describe('YearlyPerformanceChart — Branch filter', () => {
  afterEach(() => vi.restoreAllMocks());
  it('5. calls getMonthlyDailyPerformance with the correct branch', async () => {
    const spy = vi.spyOn(performance, 'getMonthlyDailyPerformance').mockResolvedValue(AUG_DAILY);
    const { rerender } = render(<YearlyPerformanceChart data={ACTUAL_DATA} branch="bypass" />);

    fireEvent.click(screen.getByTestId('view-month'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ branch: 'bypass' })));

    rerender(<YearlyPerformanceChart data={ACTUAL_DATA} branch="csb" />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ branch: 'csb' })));
  });
});

// ── 6. Total Month exact ──────────────────────────────────────────────────────
describe('YearlyPerformanceChart — Daily KPI exact values', () => {
  afterEach(() => vi.restoreAllMocks());
  it('6. Total Month equals sum of stub August daily data', async () => {
    vi.spyOn(performance, 'getMonthlyDailyPerformance').mockResolvedValue(AUG_DAILY);
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);
    fireEvent.click(screen.getByTestId('view-month'));

    await waitFor(() => {
      expect(screen.getByTestId('daily-total')).toHaveTextContent(/142\.020\.900/);
    });
  });

  it('7. Average per Day = total / count of real days', async () => {
    vi.spyOn(performance, 'getMonthlyDailyPerformance').mockResolvedValue(AUG_DAILY);
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);
    fireEvent.click(screen.getByTestId('view-month'));

    await waitFor(() => {
      expect(screen.getByTestId('daily-avg')).toHaveTextContent(/23\.670\.150/);
    });
  });

  it('8. Best Day = day 9 (highest stub value 33608000)', async () => {
    vi.spyOn(performance, 'getMonthlyDailyPerformance').mockResolvedValue(AUG_DAILY);
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);
    fireEvent.click(screen.getByTestId('view-month'));

    await waitFor(() => {
      expect(screen.getByTestId('best-day')).toHaveTextContent(/9 Aug.*33\.608\.000/);
    });
  });

  it('9. vs Previous Month shown when prev month has data', async () => {
    vi.spyOn(performance, 'getMonthlyDailyPerformance')
      .mockResolvedValueOnce(AUG_DAILY)    // current month
      .mockResolvedValueOnce(JUL_DAILY);   // prev month

    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);
    fireEvent.click(screen.getByTestId('view-month'));

    await waitFor(() => {
      expect(screen.getByTestId('vs-prev-month')).toHaveTextContent('+273.7%');
    });
  });

  it('9. vs Previous Month is "—" when on January (no previous month)', async () => {
    vi.spyOn(performance, 'getMonthlyDailyPerformance').mockResolvedValue(AUG_DAILY);
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);
    fireEvent.click(screen.getByTestId('view-month'));

    // Switch to January (month 1) — no previous month
    await waitFor(() => expect(screen.getByTestId('month-selector')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('month-selector'), { target: { value: '1' } });

    await waitFor(() => {
      expect(screen.getByTestId('vs-prev-month')).toHaveTextContent('—');
    });
  });
});

// ── 10. Parker excluded (via computeDailySummary + service) ──────────────────
describe('computeDailySummary — Parker exclusion', () => {
  it('10. Parker is absent and five Redbox branches reconcile to the all scope', async () => {
    const { MOKA_2026_DAILY_PERFORMANCE } = await import('../../data/moka2026DailyPerformance');
    const keys = Object.keys(MOKA_2026_DAILY_PERFORMANCE);
    expect(keys).not.toContain('parker');
    expect(keys.sort()).toEqual(['all', 'bypass', 'csb', 'samadikun', 'sumber', 'tegal']);

    const branchKeys = ['bypass', 'csb', 'samadikun', 'sumber', 'tegal'] as const;
    for (let month = 1; month <= 8; month++) {
      const allTotal = MOKA_2026_DAILY_PERFORMANCE.all[month]
        .reduce((sum, point) => sum + (point.net_sales ?? 0), 0);
      const branchTotal = branchKeys.reduce((sum, branch) => sum
        + MOKA_2026_DAILY_PERFORMANCE[branch][month]
          .reduce((branchSum, point) => branchSum + (point.net_sales ?? 0), 0), 0);
      expect(branchTotal).toBe(allTotal);

      const allTransactions = MOKA_2026_DAILY_PERFORMANCE.all[month]
        .reduce((sum, point) => sum + (point.transaction_count ?? 0), 0);
      const branchTransactions = branchKeys.reduce((sum, branch) => sum
        + MOKA_2026_DAILY_PERFORMANCE[branch][month]
          .reduce((branchSum, point) => branchSum + (point.transaction_count ?? 0), 0), 0);
      expect(branchTransactions).toBe(allTransactions);
    }
  });
});

// ── 11. No PII in committed daily dataset ─────────────────────────────────────
describe('DailyPerformancePoint — PII protection', () => {
  it('11. every committed point contains only aggregate-safe fields', async () => {
    const { MOKA_2026_DAILY_PERFORMANCE } = await import('../../data/moka2026DailyPerformance');
    for (const months of Object.values(MOKA_2026_DAILY_PERFORMANCE)) {
      for (const points of Object.values(months)) {
        for (const point of points) {
          expect(Object.keys(point).sort()).toEqual(['date', 'day', 'net_sales', 'transaction_count']);
        }
      }
    }
    expect(JSON.stringify(MOKA_2026_DAILY_PERFORMANCE)).not.toMatch(/customer|phone|email|receipt|invoice/i);
  });
});

// ── 12. Future/missing dates remain null ──────────────────────────────────────
describe('computeDailySummary — missing dates', () => {
  it('12. future/missing days (net_sales null) are excluded from summary', () => {
    const { computeDailySummary } = performance;
    const data = [
      { date: '2026-08-01', day: 1, net_sales: 20000000, transaction_count: 150 },
      { date: '2026-08-02', day: 2, net_sales: null, transaction_count: null },
      { date: '2026-08-03', day: 3, net_sales: 30000000, transaction_count: 200 },
    ];
    const summary = computeDailySummary(data);
    expect(summary).not.toBeNull();
    expect(summary!.activeDays).toBe(2);
    expect(summary!.total).toBe(50000000);
    expect(summary!.avgPerDay).toBe(25000000);
  });

  it('12. returns null when all days are null', () => {
    const { computeDailySummary } = performance;
    const data = [
      { date: '2026-09-01', day: 1, net_sales: null, transaction_count: null },
    ];
    expect(computeDailySummary(data)).toBeNull();
  });

  it('12. materializes missing calendar days as null instead of zero revenue', () => {
    const points = performance.fillMissingDailyPoints([
      { date: '2026-08-01', day: 1, net_sales: 1000000, transaction_count: 8 },
      { date: '2026-08-03', day: 3, net_sales: 2000000, transaction_count: 12 },
    ], 2026, 8);

    expect(points).toHaveLength(31);
    expect(points[1]).toEqual({
      date: '2026-08-02',
      day: 2,
      net_sales: null,
      transaction_count: null,
    });
  });
});

// ── 13. Tooltip transaction count ─────────────────────────────────────────────
describe('YearlyPerformanceChart — month selector', () => {
  afterEach(() => vi.restoreAllMocks());
  it('13. month selector lists Jan–Aug only (8 options)', async () => {
    vi.spyOn(performance, 'getMonthlyDailyPerformance').mockResolvedValue(AUG_DAILY);
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);
    fireEvent.click(screen.getByTestId('view-month'));

    await waitFor(() => expect(screen.getByTestId('month-selector')).toBeInTheDocument());
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(8);
  });
});

describe('DailyPerformanceTooltip', () => {
  it('13. shows the exact transaction count and previous-calendar-day comparison', () => {
    render(
      <DailyPerformanceTooltip
        active
        coordinate={{ x: 0, y: 0 }}
        accessibilityLayer={false}
        activeIndex="0"
        payload={[{
          payload: {
            date: '2026-08-15',
            day: 15,
            net_sales: 23803500,
            transaction_count: 176,
            prevNetSales: 22017000,
            prevDay: 14,
          },
        }] as never}
      />,
    );

    expect(screen.getByText('15 August 2026')).toBeInTheDocument();
    expect(screen.getByText('176')).toBeInTheDocument();
    expect(screen.getByText('vs day 14')).toBeInTheDocument();
    expect(screen.getByText('+8.1%')).toBeInTheDocument();
  });

  it('omits comparison when the previous calendar day is unavailable', () => {
    render(
      <DailyPerformanceTooltip
        active
        coordinate={{ x: 0, y: 0 }}
        accessibilityLayer={false}
        activeIndex="0"
        payload={[{
          payload: {
            date: '2026-08-15',
            day: 15,
            net_sales: 23803500,
            transaction_count: 176,
            prevNetSales: null,
            prevDay: null,
          },
        }] as never}
      />,
    );

    expect(screen.queryByText(/vs day/)).not.toBeInTheDocument();
  });
});

// ── 14. Build + 15. Existing tests remain green — covered by full vitest run ──
// (no separate test needed here; we run the full suite at the end)

// ── Service contract tests ────────────────────────────────────────────────────
describe('getMonthlyDailyPerformance service', () => {
  it('returns empty array for year ≠ 2026', async () => {
    const { getMonthlyDailyPerformance } = await import('../../services/performance');
    const data = await getMonthlyDailyPerformance({ branch: 'all', year: 2025, month: 8 });
    expect(data).toEqual([]);
  });

  it('returns empty array for month > 8 (future months)', async () => {
    const { getMonthlyDailyPerformance } = await import('../../services/performance');
    const data = await getMonthlyDailyPerformance({ branch: 'all', year: 2026, month: 9 });
    expect(data).toEqual([]);
  });

  it('returns real data for August 2026 all branches (31 days)', async () => {
    const { getMonthlyDailyPerformance } = await import('../../services/performance');
    const data = await getMonthlyDailyPerformance({ branch: 'all', year: 2026, month: 8 });
    expect(data.length).toBe(31);
    const total = data.reduce((s, p) => s + (p.net_sales ?? 0), 0);
    expect(total).toBe(583483400);
  });

  it('unknown branch defaults to "all" scope', async () => {
    const { getMonthlyDailyPerformance } = await import('../../services/performance');
    const all = await getMonthlyDailyPerformance({ branch: 'all', year: 2026, month: 8 });
    const unknown = await getMonthlyDailyPerformance({ branch: 'unknown-xyz', year: 2026, month: 8 });
    expect(unknown).toEqual(all);
  });
});

// ── computeDailySummary exact August values ───────────────────────────────────
describe('computeDailySummary — August 2026 canonical values', () => {
  it('August total = 583,483,400', async () => {
    const { getMonthlyDailyPerformance, computeDailySummary } = await import('../../services/performance');
    const aug = await getMonthlyDailyPerformance({ branch: 'all', year: 2026, month: 8 });
    const summary = computeDailySummary(aug);
    expect(summary!.total).toBe(583483400);
  });

  it('August best day = 9 with 33,608,000', async () => {
    const { getMonthlyDailyPerformance, computeDailySummary } = await import('../../services/performance');
    const aug = await getMonthlyDailyPerformance({ branch: 'all', year: 2026, month: 8 });
    const summary = computeDailySummary(aug);
    expect(summary!.bestDay.day).toBe(9);
    expect(summary!.bestDay.net_sales).toBe(33608000);
  });

  it('August average/day = 18,822,045 (583483400/31)', async () => {
    const { getMonthlyDailyPerformance, computeDailySummary } = await import('../../services/performance');
    const aug = await getMonthlyDailyPerformance({ branch: 'all', year: 2026, month: 8 });
    const summary = computeDailySummary(aug);
    expect(summary!.avgPerDay).toBe(18822045);
  });

  it('August vs July = +0.8%', async () => {
    const { getMonthlyDailyPerformance, computeDailySummary } = await import('../../services/performance');
    const [aug, jul] = await Promise.all([
      getMonthlyDailyPerformance({ branch: 'all', year: 2026, month: 8 }),
      getMonthlyDailyPerformance({ branch: 'all', year: 2026, month: 7 }),
    ]);
    const summary = computeDailySummary(aug, jul);
    expect(summary!.vsLastMonth?.formatted).toBe('+0.8%');
  });
});
