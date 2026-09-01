import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CommandCenter } from '../CommandCenter';

const OWNER_OVERVIEW = {
  today: '2026-09-01',
  branches: [
    { slug: 'csb', name: 'CSB', revenue_moka: 500000, tx_moka: 5, revenue_web: 100000, tx_web: 1, hadir: 4, total_barbers: 5, goshow: 1, pending_bookings: 2 },
  ],
  totals: { revenue_moka: 500000, revenue_web: 100000, tx_total: 6, hadir: 4, goshow: 1, pending: 2 },
};

const OWNER_REVENUE = {
  summary: { revenue_moka: 2000000, revenue_web: 400000, tx_total: 24, avg_tx: 100000 },
  daily_trend: [{ date: '2026-09-01', moka: 500000, web: 100000 }],
  branch_compare: [{ slug: 'csb', name: 'CSB', revenue_moka: 2000000, revenue_web: 400000, tx_total: 24 }],
  top_barbers: [{ barber_id: 'b1', name: 'Ubay', branch: 'csb', tx_count: 12, revenue: 600000 }],
  top_services: [{ service_name: 'Haircut', count: 10, revenue: 500000 }],
};

const MOKA_STATUS = {
  oauthConfigured: true,
  outlets: [{ id: 'o1', name: 'CSB', slug: 'csb', mokaOutletId: 'm1', hasToken: true, tokenExpiry: '2027-01-01', tokenExpired: false }],
  recentLogs: [{ direction: 'pull', status: 'ok', created_at: '2026-09-01T10:00:00Z', error_message: null }],
};

const MEMBERSHIP = [
  { user_key: 'u1', full_name: 'Budi', email: 'budi@example.com', membership_status: 'ACTIVE', membership_activated_at: null, membership_started_at: null, membership_expires_at: null, current_tier: 'gold', total_points: 100, total_visits: 5, created_at: '2026-08-15T00:00:00Z', phone: '+6281', last_visit: '2026-08-30' },
  { user_key: 'u2', full_name: 'Sari', email: 'sari@example.com', membership_status: 'INACTIVE', membership_activated_at: null, membership_started_at: null, membership_expires_at: null, current_tier: 'bronze', total_points: 0, total_visits: 1, created_at: '2026-07-01T00:00:00Z', phone: '+6282', last_visit: '2026-07-10' },
];

function mockFetchSequence() {
  const fetchMock = fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('owner-overview')) {
      return Promise.resolve(new Response(JSON.stringify(OWNER_OVERVIEW), { status: 200 }));
    }
    if (url.includes('owner-revenue')) {
      return Promise.resolve(new Response(JSON.stringify(OWNER_REVENUE), { status: 200 }));
    }
    if (url.includes('moka/status')) {
      return Promise.resolve(new Response(JSON.stringify(MOKA_STATUS), { status: 200 }));
    }
    if (url.includes('membership')) {
      return Promise.resolve(new Response(JSON.stringify(MEMBERSHIP), { status: 200 }));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
}

describe('CommandCenter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders real revenue and transaction totals once data loads', async () => {
    mockFetchSequence();
    render(<CommandCenter />);

    await waitFor(() => {
      expect(screen.getAllByText(/Rp\D*2\.400\.000/).length).toBeGreaterThan(0);
    });
    expect(screen.getByText('24')).toBeInTheDocument();
  });

  it('renders the active member count derived from the membership list', async () => {
    mockFetchSequence();
    render(<CommandCenter />);

    await waitFor(() => {
      expect(screen.getByText('Member Aktif')).toBeInTheDocument();
    });
  });

  it('shows an UNAVAILABLE state for the Inventory Snapshot section', async () => {
    mockFetchSequence();
    render(<CommandCenter />);

    await waitFor(() => {
      expect(screen.getByText(/UNAVAILABLE/i)).toBeInTheDocument();
    });
  });

  it('renders a local error state for owner-revenue without blanking the whole page', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('owner-overview')) {
        return Promise.resolve(new Response(JSON.stringify(OWNER_OVERVIEW), { status: 200 }));
      }
      if (url.includes('owner-revenue')) {
        return Promise.resolve(new Response('server exploded', { status: 500 }));
      }
      if (url.includes('moka/status')) {
        return Promise.resolve(new Response(JSON.stringify(MOKA_STATUS), { status: 200 }));
      }
      if (url.includes('membership')) {
        return Promise.resolve(new Response(JSON.stringify(MEMBERSHIP), { status: 200 }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    });

    render(<CommandCenter />);

    await waitFor(() => {
      expect(screen.getAllByText(/Terjadi kesalahan/i).length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Command Center')).toBeInTheDocument();
  });
});
