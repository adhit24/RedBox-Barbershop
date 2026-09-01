import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CustomerReport } from '../CustomerReport';

const RESULT = {
  data_coverage: { from: '2025-05-10', to: '2026-08-31', classification_basis: 'test' },
  kpis: { active_customers: 10, new_customers: 3, repeat_customers: 5, loyal_customers: 2, dormant_customers: 4, avg_visit_interval_days: 21.5 },
  segments: [],
  new_vs_repeat_trend: [{ month: '2026-08', new: 2, repeat: 3 }],
  by_branch: [{ branch: 'csb', count: 8 }],
  favorite_barbers: [{ name: 'Ubay Santoso', count: 12 }],
  favorite_services: [{ service_name: 'Haircut Classic', count: 20 }],
  customers: {
    items: [{ customer_key: 'phone:6281', name: 'Bima Aditya', first_visit: '2026-01-01', last_visit: '2026-08-01', total_visits: 14, favorite_branch: 'csb', favorite_barber: 'Ubay Santoso', visit_count_tier: 'loyal', engagement_status: 'active' }],
    total: 1,
    limit: 50,
    offset: 0,
  },
};

describe('CustomerReport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the KPI cards with real counts', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    render(<CustomerReport />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('Active Customers')).toBeInTheDocument();
    });
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders favorite barber and service leaderboards', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    render(<CustomerReport />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getAllByText('Ubay Santoso').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Haircut Classic')).toBeInTheDocument();
  });

  it('renders the customer detail table', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    render(<CustomerReport />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('Bima Aditya')).toBeInTheDocument();
    });
  });
});
