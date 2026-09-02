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

  it('defaults to the "all" scope for an unrecognized branch value', async () => {
    const all = await getYearlyPerformance('all');
    const unknown = await getYearlyPerformance('some-unknown-branch');

    expect(unknown).toEqual(all);
  });
});
