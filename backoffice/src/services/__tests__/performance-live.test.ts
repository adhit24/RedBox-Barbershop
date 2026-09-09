import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/apiClient';
import {
  computeDailySummary,
  computePerformanceSummary,
  getMonthlyDailyPerformance,
  getYearlyPerformance,
} from '../performance';

describe('database-first business performance', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('overlays live September MTD while retaining static historical fallback months', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      points: [{ month: 9, month_label: 'Sep', net_sales: 157722000, transaction_count: 1214 }],
    });
    const result = await getYearlyPerformance('all');
    expect(result[7].net_sales).toBe(583483400);
    expect(result[8]).toMatchObject({ net_sales: 157722000, transaction_count: 1214 });
    expect(result[9].net_sales).toBeNull();
  });

  it('requests the selected branch/month and returns database daily rows', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({
      points: [{ date: '2026-09-08', day: 8, net_sales: 3840000, transaction_count: 26 }],
    });
    const result = await getMonthlyDailyPerformance({ branch: 'bypass', year: 2026, month: 9 });
    expect(get).toHaveBeenCalledWith(expect.stringContaining('branch=bypass'));
    expect(result).toEqual([{ date: '2026-09-08', day: 8, net_sales: 3840000, transaction_count: 26 }]);
  });

  it('uses static Jan-Aug only when database access is unavailable', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('offline'));
    expect(await getMonthlyDailyPerformance({ branch: 'all', year: 2026, month: 8 })).toHaveLength(31);
    expect(await getMonthlyDailyPerformance({ branch: 'all', year: 2026, month: 9 })).toEqual([]);
  });

  it('Latest MoM ignores incomplete September and compares completed August to July', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T00:00:00+07:00'));
    const summary = computePerformanceSummary([
      { month: 7, month_label: 'Jul', net_sales: 100, transaction_count: 1 },
      { month: 8, month_label: 'Aug', net_sales: 110, transaction_count: 1 },
      { month: 9, month_label: 'Sep', net_sales: 50, transaction_count: 1 },
    ]);
    expect(summary?.latestMoM?.currentMonth.month).toBe(8);
    expect(summary?.latestMoM?.formatted).toBe('+10.0%');
    vi.useRealTimers();
  });

  it('MTD comparison uses matching prior-month day range', () => {
    const current = [
      { date: '2026-09-01', day: 1, net_sales: 100, transaction_count: 1 },
      { date: '2026-09-02', day: 2, net_sales: 100, transaction_count: 1 },
    ];
    const previous = [
      { date: '2026-08-01', day: 1, net_sales: 50, transaction_count: 1 },
      { date: '2026-08-02', day: 2, net_sales: 50, transaction_count: 1 },
      { date: '2026-08-03', day: 3, net_sales: 1000, transaction_count: 1 },
    ];
    expect(computeDailySummary(current, previous, true)?.vsLastMonth?.pct).toBe(100);
  });
});
