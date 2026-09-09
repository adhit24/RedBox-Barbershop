import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CommandCenter } from '../CommandCenter';
import { AuthProvider } from '../../auth/AuthProvider';

function renderCC() {
  return render(<MemoryRouter><AuthProvider><CommandCenter /></AuthProvider></MemoryRouter>);
}

function cardOf(text: HTMLElement): HTMLElement {
  const card = text.closest<HTMLElement>('.rounded-rb-card');
  if (!card) throw new Error('No card ancestor found');
  return card;
}

const OWNER_OVERVIEW = {
  today: '2026-09-09',
  branches: [
    { slug: 'csb', name: 'CSB', revenue_moka: 0, tx_moka: 0, revenue_web: 0, tx_web: 0, hadir: 0, total_barbers: 7, goshow: 0, pending_bookings: 2 },
    { slug: 'tegal', name: 'Tegal', revenue_moka: 0, tx_moka: 0, revenue_web: 0, tx_web: 0, hadir: 0, total_barbers: 6, goshow: 0, pending_bookings: 0 },
  ],
  totals: { revenue_moka: 0, revenue_web: 0, tx_total: 0, hadir: 0, goshow: 0, pending: 2 },
};

function branchData(bookingToday: number, pending: number, alerts: { type: string; message: string }[] = []) {
  return {
    today: '2026-09-09', barbers: [],
    stats: { hadir: 0, tidak_hadir: 0, belum_check_in: 7, booking_today: bookingToday, pending, home_service_active: 0, moka_open_bills: 0 },
    home_service: [], booking_feed: [], moka_open_bills: [], alerts,
  };
}

const CUSTOMER_SEGMENTS = {
  data_coverage: { from: '2026-01-01', to: '2026-09-09', classification_basis: 'visit_history' },
  kpis: { active_customers: 400, new_customers: 15, repeat_customers: 731, loyal_customers: 50, dormant_customers: 20, avg_visit_interval_days: 30 },
  segments: [], new_vs_repeat_trend: [], by_branch: [], favorite_barbers: [], favorite_services: [],
  customers: { items: [], total: 0, limit: 1, offset: 0 },
};

const MEMBERSHIP = [
  { user_key: 'u1', full_name: 'Budi', email: 'budi@example.com', membership_status: 'ACTIVE', membership_activated_at: null, membership_started_at: null, membership_expires_at: null, current_tier: 'gold', total_points: 100, total_visits: 5, created_at: '2026-01-01', phone: null, last_visit: null },
  { user_key: 'u2', full_name: 'Sari', email: 'sari@example.com', membership_status: 'INACTIVE', membership_activated_at: null, membership_started_at: null, membership_expires_at: null, current_tier: 'bronze', total_points: 0, total_visits: 1, created_at: '2026-01-01', phone: null, last_visit: null },
  { user_key: 'u3', full_name: 'Wati', email: 'wati@example.com', membership_status: 'ACTIVE', membership_activated_at: null, membership_started_at: null, membership_expires_at: null, current_tier: 'silver', total_points: 20, total_visits: 2, created_at: '2026-01-01', phone: null, last_visit: null },
];

function mockFetch() {
  const fetchMock = fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('owner-overview')) return Promise.resolve(new Response(JSON.stringify(OWNER_OVERVIEW), { status: 200 }));
    if (url.includes('command-center?branch=csb')) return Promise.resolve(new Response(JSON.stringify(branchData(30, 2, [{ type: 'attendance', message: '7 barber belum check-in' }])), { status: 200 }));
    if (url.includes('command-center?branch=tegal')) return Promise.resolve(new Response(JSON.stringify(branchData(20, 0, [{ type: 'attendance', message: '6 barber belum check-in' }])), { status: 200 }));
    if (url.includes('customer-segments')) return Promise.resolve(new Response(JSON.stringify(CUSTOMER_SEGMENTS), { status: 200 }));
    if (url.includes('barber-performance')) return Promise.resolve(new Response(JSON.stringify({ barbers: [{ barber_id: 'b1', name: 'Ubay', branch: 'csb', customers_served: 40, completed_services: 55, repeat_rate: 0.6 }] }), { status: 200 }));
    if (url.includes('membership')) return Promise.resolve(new Response(JSON.stringify(MEMBERSHIP), { status: 200 }));
    if (url.includes('business-performance')) return Promise.resolve(new Response(JSON.stringify({ points: [{ month: 9, month_label: 'Sep', net_sales: 157722000, transaction_count: 1214 }] }), { status: 200 }));
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
}

describe('CommandCenter real-data-only contract', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders database-backed booking, repeat customer, membership, barber, and business-performance metrics', async () => {
    mockFetch();
    renderCC();
    await waitFor(() => expect(within(cardOf(screen.getByText('Booking Hari Ini'))).getByText('50')).toBeInTheDocument());
    expect(screen.getAllByText('731').length).toBeGreaterThan(0);
    expect(within(cardOf(screen.getByText('Active Members'))).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Kapster terukur')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open September 2026 daily performance' })).toBeInTheDocument();
  });

  it('renders unavailable metrics as dashes and never substitutes demo values', async () => {
    mockFetch();
    renderCC();
    await screen.findByText('Completed Services');
    for (const label of ['Completed Services', 'Attendance Alerts', 'Payroll Pending']) {
      const card = cardOf(screen.getByText(label));
      expect(within(card).getByText('—')).toBeInTheDocument();
      expect(within(card).getByText('Belum tersedia')).toBeInTheDocument();
    }
    expect(screen.queryByText(/demo|dummy|sample/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Ramai')).not.toBeInTheDocument();
  });

  it('uses pending booking facts for branch status and ignores unverified attendance alerts', async () => {
    mockFetch();
    renderCC();
    await screen.findByText('30 booking hari ini');
    expect(screen.getByText('Booking perlu review')).toBeInTheDocument();
    expect(screen.getByText('Tidak ada booking pending')).toBeInTheDocument();
    expect(screen.queryByText(/barber belum check-in/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Perlu Perhatian')).not.toBeInTheDocument();
  });

  it('keeps honest unavailable priority pills and the real booking issue count', async () => {
    mockFetch();
    renderCC();
    await waitFor(() => expect(screen.getByRole('link', { name: /Booking Issues/ })).toHaveTextContent('2 Booking Issues'));
    expect(screen.getByText(/— Attendance Issues/)).toBeInTheDocument();
    expect(screen.getAllByText(/— Payroll Pending/).length).toBeGreaterThan(0);
    expect(screen.getByText(/— Low Stock Alerts/)).toBeInTheDocument();
  });

  it("removes technical owner cards and their unnecessary Moka log fetch", async () => {
    mockFetch();
    renderCC();
    await screen.findByText('Business Snapshots');
    expect(screen.queryByText("Today's Operations Timeline")).not.toBeInTheDocument();
    expect(screen.queryByText('Alerts & Exceptions')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cari')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Notifikasi')).not.toBeInTheDocument();
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map(([input]) => String(input));
    expect(calls.some(url => url.includes('sync-logs'))).toBe(false);
  });

  it('keeps real Action Center and honest unavailable Stockist/Payroll snapshots', async () => {
    mockFetch();
    renderCC();
    await screen.findByText(/2 booking menunggu konfirmasi/i);
    expect(within(cardOf(screen.getByText('Inventory Snapshot'))).getByText('UNAVAILABLE')).toBeInTheDocument();
    expect(within(cardOf(screen.getByText('Payroll Snapshot'))).getByText('UNAVAILABLE')).toBeInTheDocument();
    expect(within(cardOf(screen.getByText('Customer Snapshot'))).getByText('731')).toBeInTheDocument();
  });
});
