import { describe, it, expect } from 'vitest';
import { getYearlyPerformance, LATEST_ACTUAL_MONTH } from '../performance';

describe('getYearlyPerformance', () => {
  it('returns all 12 months for the "all" branch scope', async () => {
    const data = await getYearlyPerformance('all');

    expect(data).toHaveLength(12);
    expect(data.map((p) => p.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('never fabricates net_sales for months after the last real data point', async () => {
    const data = await getYearlyPerformance('all');

    const futureMonths = data.filter((p) => p.month > LATEST_ACTUAL_MONTH);
    futureMonths.forEach((p) => {
      expect(p.net_sales).toBeNull();
      expect(p.transaction_count).toBeNull();
    });
  });

  it('returns real, non-null net_sales for every month through the last actual month', async () => {
    const data = await getYearlyPerformance('all');

    const actualMonths = data.filter((p) => p.month <= LATEST_ACTUAL_MONTH);
    actualMonths.forEach((p) => {
      expect(p.net_sales).not.toBeNull();
      expect(typeof p.net_sales).toBe('number');
    });
  });

  it('scopes data to a specific branch when given a recognized branch slug', async () => {
    const all = await getYearlyPerformance('all');
    const bypass = await getYearlyPerformance('bypass');

    expect(bypass).not.toEqual(all);
    expect(bypass[0].net_sales).toBeLessThan(all[0].net_sales ?? 0);
  });

  it('computes exact canonical metrics for all branches (YTD, avg, best month, latest MoM)', async () => {
    const data = await getYearlyPerformance('all');
    const actual = data.filter((p) => p.net_sales !== null);

    // 1. Expected YTD: 4,588,709,400
    const ytd = actual.reduce((sum, p) => sum + (p.net_sales ?? 0), 0);
    expect(ytd).toBe(4588709400);

    // 2. Expected average Jan-Aug: 573,588,675
    const avg = ytd / actual.length;
    expect(avg).toBe(573588675);

    // 3. Expected best month: March (month 3) with 720,683,200
    const best = actual.reduce((a, b) => ((b.net_sales ?? 0) > (a.net_sales ?? 0) ? b : a));
    expect(best.month).toBe(3);
    expect(best.month_label).toBe('Mar');
    expect(best.net_sales).toBe(720683200);

    // 4. Expected latest MoM Aug vs Jul: +0.8%
    const jul = actual.find((p) => p.month === 7);
    const aug = actual.find((p) => p.month === 8);
    expect(jul?.net_sales).toBe(578949900);
    expect(aug?.net_sales).toBe(583483400);
    const mom = ((aug!.net_sales! - jul!.net_sales!) / jul!.net_sales!) * 100;
    expect(mom.toFixed(1)).toBe('0.8');
  });

  it('excludes Parker and ensures the 5 Redbox branches sum up exactly to the all-branches total', async () => {
    const all = await getYearlyPerformance('all');
    const branches = ['bypass', 'csb', 'samadikun', 'sumber', 'tegal'] as const;
    const branchData = await Promise.all(branches.map((b) => getYearlyPerformance(b)));

    // Verify for each of the 8 actual months
    for (let m = 1; m <= 8; m++) {
      const allPoint = all.find((p) => p.month === m);
      const sumNetSales = branchData.reduce((sum, bPoints) => {
        const point = bPoints.find((p) => p.month === m);
        return sum + (point?.net_sales ?? 0);
      }, 0);
      const sumTx = branchData.reduce((sum, bPoints) => {
        const point = bPoints.find((p) => p.month === m);
        return sum + (point?.transaction_count ?? 0);
      }, 0);

      expect(allPoint?.net_sales).toBe(sumNetSales);
      expect(allPoint?.transaction_count).toBe(sumTx);
    }
  });
});

