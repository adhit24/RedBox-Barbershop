import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { YearlyPerformanceChart } from '../YearlyPerformanceChart';
import type { MonthlyPerformancePoint } from '../../services/performance';

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

describe('YearlyPerformanceChart', () => {
  it('renders the title and Indonesian subtitle', () => {
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);

    expect(screen.getByText('Performance by Year')).toBeInTheDocument();
    expect(screen.getByText('Performa bulanan Redbox sepanjang 2026')).toBeInTheDocument();
  });

  it('computes YTD Net Sales, average per month, and best month from real Jan-Aug data only', () => {
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);

    // YTD = sum of Jan-Aug = 4,588,709,400 -> Rp 4,59 Miliar
    expect(screen.getByText('Rp 4,59 Miliar')).toBeInTheDocument();
    // Best month is March (highest net_sales among actuals)
    expect(screen.getByText(/Mar/)).toBeInTheDocument();
  });

  it('never fabricates figures for months without real data', () => {
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);

    expect(screen.queryByText(/Rp\s?0/)).not.toBeInTheDocument();
  });

  it('shows an honest empty state when no month has real data yet', () => {
    const allNull = ACTUAL_DATA.map((p) => ({ ...p, net_sales: null, transaction_count: null }));
    render(<YearlyPerformanceChart data={allNull} />);

    expect(screen.getByText('Belum ada data performa tahunan.')).toBeInTheDocument();
  });

  it('renders the data-honesty footer caption', () => {
    render(<YearlyPerformanceChart data={ACTUAL_DATA} />);

    expect(screen.getByText(/Data aktual Januari–Agustus 2026 dari Moka POS/)).toBeInTheDocument();
  });
});
