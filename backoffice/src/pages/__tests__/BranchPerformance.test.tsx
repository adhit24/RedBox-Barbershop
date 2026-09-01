import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BranchPerformance } from '../BranchPerformance';

const OWNER_REVENUE = {
  summary: { revenue_moka: 0, revenue_web: 0, tx_total: 0, avg_tx: 0 },
  daily_trend: [],
  branch_compare: [{ slug: 'csb', name: 'CSB', revenue_moka: 2000000, revenue_web: 400000, tx_total: 28 }],
  top_barbers: [],
  top_services: [],
};

const SEGMENTS = {
  data_coverage: { from: null, to: null, classification_basis: 'test' },
  kpis: { active_customers: 0, new_customers: 0, repeat_customers: 0, loyal_customers: 0, dormant_customers: 0, avg_visit_interval_days: null },
  segments: [],
  new_vs_repeat_trend: [],
  by_branch: [{ branch: 'csb', count: 412, total_customers: 412, repeat_customers: 240 }],
  favorite_barbers: [],
  favorite_services: [],
  customers: { items: [], total: 0, limit: 50, offset: 0 },
};

function mockFetch() {
  const fetchMock = fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('owner-revenue')) return Promise.resolve(new Response(JSON.stringify(OWNER_REVENUE), { status: 200 }));
    if (url.includes('customer-segments')) return Promise.resolve(new Response(JSON.stringify(SEGMENTS), { status: 200 }));
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
}

describe('BranchPerformance', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a row per branch with real customer and transaction counts', async () => {
    mockFetch();
    render(<BranchPerformance />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('CSB')).toBeInTheDocument();
    });
    expect(screen.getByText('412')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
  });

  it('does not render an Attendance Issue or Alert column', async () => {
    mockFetch();
    render(<BranchPerformance />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('CSB')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Attendance Issue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Alert/i)).not.toBeInTheDocument();
  });
});
