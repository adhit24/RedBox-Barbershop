import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CRMOverview } from '../CRMOverview';

const SEGMENTS_RESULT = {
  data_coverage: { from: '2025-05-10', to: '2026-08-31', classification_basis: 'test' },
  kpis: { active_customers: 10, new_customers: 3, repeat_customers: 5, loyal_customers: 2, dormant_customers: 4, avg_visit_interval_days: 21.5 },
  segments: [
    { key: 'loyal', label: 'Loyal (10+ visit)', count: 2 },
    { key: 'repeat', label: 'Repeat (3-9 visit)', count: 5 },
    { key: 'new', label: 'Baru (1-2 visit)', count: 3 },
    { key: 'dormant', label: 'Dormant (60d+)', count: 4 },
  ],
  new_vs_repeat_trend: [],
  by_branch: [],
  favorite_barbers: [],
  favorite_services: [],
  customers: {
    items: [{ customer_key: 'phone:6281', name: 'Bima Aditya', first_visit: '2026-01-01', last_visit: '2026-08-01', total_visits: 14, favorite_branch: 'csb', favorite_barber: 'Ubay Santoso', visit_count_tier: 'loyal', engagement_status: 'active' }],
    total: 1,
    limit: 50,
    offset: 0,
  },
};

describe('CRMOverview', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the segment breakdown with real counts', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(SEGMENTS_RESULT), { status: 200 }));
    render(<CRMOverview />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('Loyal (10+ visit)')).toBeInTheDocument();
    });
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders a sample customer row linking to Customer 360', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(SEGMENTS_RESULT), { status: 200 }));
    render(<CRMOverview />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('Bima Aditya')).toBeInTheDocument();
    });
    const link = screen.getByRole('link', { name: /Bima Aditya/i });
    expect(link.getAttribute('href')).toBe('/crm/customers/phone%3A6281');
  });

  it('shows the reactivation panel as UNAVAILABLE for points-expiring and birthdays', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(SEGMENTS_RESULT), { status: 200 }));
    render(<CRMOverview />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText(/UNAVAILABLE/i)).toBeInTheDocument();
    });
  });
});
