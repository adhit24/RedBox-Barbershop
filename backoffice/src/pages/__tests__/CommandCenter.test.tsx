import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CommandCenter } from '../CommandCenter';
import { AuthProvider } from '../../auth/AuthProvider';
import type { MemberProfile } from '../../services/crm';

function renderCC() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <CommandCenter />
      </AuthProvider>
    </MemoryRouter>
  );
}

/** Robust card lookup: walk up from a text node to the nearest `.rounded-rb-card` ancestor. */
function cardOf(text: HTMLElement): HTMLElement {
  const card = text.closest<HTMLElement>('.rounded-rb-card');
  if (!card) throw new Error('No .rounded-rb-card ancestor found');
  return card;
}

const NOW = new Date();
const TODAY_ISO = NOW.toISOString();
// 30h back guarantees a different Asia/Jakarta calendar day regardless of current UTC offset.
const YESTERDAY_ISO = new Date(NOW.getTime() - 30 * 60 * 60 * 1000).toISOString();
// 45 days back guarantees a different year-month, since no month exceeds 31 days.
const LAST_MONTH_ISO = new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString();

const OWNER_OVERVIEW = {
  today: '2026-09-01',
  branches: [
    { slug: 'csb', name: 'CSB', revenue_moka: 0, tx_moka: 0, revenue_web: 0, tx_web: 0, hadir: 4, total_barbers: 5, goshow: 1, pending_bookings: 2 },
    { slug: 'pdk', name: 'Pondok Indah', revenue_moka: 0, tx_moka: 0, revenue_web: 0, tx_web: 0, hadir: 3, total_barbers: 4, goshow: 0, pending_bookings: 1 },
  ],
  totals: { revenue_moka: 0, revenue_web: 0, tx_total: 0, hadir: 7, goshow: 1, pending: 3 },
};

function branchData(bookingToday: number, pending: number, belumCheckIn: number, alerts: { type: string; message: string }[] = []) {
  return {
    today: '2026-09-01',
    barbers: [
      { id: 'b1', name: 'Ubay', branch: 'csb', attendance_status: 'hadir', today_count: 2 },
      { id: 'b2', name: 'Dedi', branch: 'csb', attendance_status: null, today_count: 0 },
    ],
    stats: {
      hadir: 4,
      tidak_hadir: 0,
      belum_check_in: belumCheckIn,
      booking_today: bookingToday,
      pending,
      home_service_active: 0,
      moka_open_bills: 0,
    },
    home_service: [],
    booking_feed: [
      { id: 'bk1', status: 'pending' as const, time: '10:00', barber_id: 'b1', name: 'Andi', wa: null, service: 'Haircut', notes: null },
    ],
    moka_open_bills: [],
    alerts,
  };
}

const CUSTOMER_SEGMENTS = {
  data_coverage: { from: '2026-01-01', to: '2026-09-01', classification_basis: 'visit_history' },
  kpis: { active_customers: 400, new_customers: 15, repeat_customers: 731, loyal_customers: 50, dormant_customers: 20, avg_visit_interval_days: 30 },
  segments: [],
  new_vs_repeat_trend: [],
  by_branch: [],
  favorite_barbers: [],
  favorite_services: [],
  customers: { items: [], total: 0, limit: 0, offset: 0 },
};

const BARBER_PERFORMANCE = {
  barbers: [
    { barber_id: 'b1', name: 'Ubay', branch: 'csb', customers_served: 40, completed_services: 55, repeat_rate: 0.6 },
    { barber_id: 'b2', name: 'Dedi', branch: 'pdk', customers_served: 30, completed_services: 42, repeat_rate: 0.4 },
  ],
};

const MEMBERSHIP: MemberProfile[] = [
  { user_key: 'u1', full_name: 'Budi', email: 'budi@example.com', membership_status: 'ACTIVE', membership_activated_at: null, membership_started_at: null, membership_expires_at: null, current_tier: 'gold', total_points: 100, total_visits: 5, created_at: '2026-09-01T00:00:00Z', phone: '+6281', last_visit: '2026-08-30' },
  { user_key: 'u2', full_name: 'Sari', email: 'sari@example.com', membership_status: 'INACTIVE', membership_activated_at: null, membership_started_at: null, membership_expires_at: null, current_tier: 'bronze', total_points: 0, total_visits: 1, created_at: '2026-01-01T00:00:00Z', phone: '+6282', last_visit: '2026-07-10' },
  { user_key: 'u3', full_name: 'Wati', email: 'wati@example.com', membership_status: 'ACTIVE', membership_activated_at: null, membership_started_at: null, membership_expires_at: null, current_tier: 'silver', total_points: 20, total_visits: 2, created_at: '2026-02-01T00:00:00Z', phone: '+6283', last_visit: '2026-08-20' },
];

const MOKA_SYNC_LOGS = {
  logs: [
    { id: 'l1', direction: 'pull', entity_type: 'transaction', entity_id: 't1', status: 'ok', error_message: null, retry_count: 0, created_at: TODAY_ISO },
    { id: 'l2', direction: 'push', entity_type: 'booking', entity_id: 'b2', status: 'error', error_message: 'Outlet token expired', retry_count: 1, created_at: TODAY_ISO },
  ],
};

function mockFetch(overrides: { branchFailFor?: string[]; mokaLogs?: typeof MOKA_SYNC_LOGS; membership?: typeof MEMBERSHIP } = {}) {
  const fetchMock = fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('owner-overview')) {
      return Promise.resolve(new Response(JSON.stringify(OWNER_OVERVIEW), { status: 200 }));
    }
    if (url.includes('command-center?branch=csb')) {
      if (overrides.branchFailFor?.includes('csb')) return Promise.resolve(new Response('fail', { status: 500 }));
      return Promise.resolve(new Response(JSON.stringify(branchData(30, 2, 1, [{ type: 'low_attendance', message: 'Barber hadir di bawah 50%' }])), { status: 200 }));
    }
    if (url.includes('command-center?branch=pdk')) {
      if (overrides.branchFailFor?.includes('pdk')) return Promise.resolve(new Response('fail', { status: 500 }));
      return Promise.resolve(new Response(JSON.stringify(branchData(20, 1, 0)), { status: 200 }));
    }
    if (url.includes('customer-segments')) {
      return Promise.resolve(new Response(JSON.stringify(CUSTOMER_SEGMENTS), { status: 200 }));
    }
    if (url.includes('barber-performance')) {
      return Promise.resolve(new Response(JSON.stringify(BARBER_PERFORMANCE), { status: 200 }));
    }
    if (url.includes('membership')) {
      return Promise.resolve(new Response(JSON.stringify(overrides.membership ?? MEMBERSHIP), { status: 200 }));
    }
    if (url.includes('sync-logs')) {
      return Promise.resolve(new Response(JSON.stringify(overrides.mokaLogs ?? MOKA_SYNC_LOGS), { status: 200 }));
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

  it('never renders revenue, currency, or financial KPI language', async () => {
    mockFetch();
    renderCC();

    await waitFor(() => {
      expect(screen.getByText('Booking Hari Ini')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Rp\s?\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/revenue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/profit/i)).not.toBeInTheDocument();
  });

  it('renders real cross-branch booking total on the Booking Hari Ini KPI card', async () => {
    mockFetch();
    renderCC();

    await waitFor(() => {
      const card = cardOf(screen.getByText('Booking Hari Ini'));
      expect(within(card).getByText('50')).toBeInTheDocument();
    });
  });

  it('shows honest unavailable indicators on Completed Services, Attendance Alerts, and Payroll Pending KPI cards', async () => {
    mockFetch();
    renderCC();

    await waitFor(() => {
      expect(screen.getByText('Completed Services')).toBeInTheDocument();
    });

    for (const label of ['Completed Services', 'Attendance Alerts', 'Payroll Pending']) {
      const card = cardOf(screen.getByText(label));
      expect(within(card).getByText(/belum tersedia/i)).toBeInTheDocument();
    }
  });

  it('renders real repeat customer and active member counts', async () => {
    mockFetch();
    renderCC();

    await waitFor(() => {
      expect(screen.getAllByText('731').length).toBeGreaterThan(0);
    });
    const card = cardOf(screen.getByText('Active Members'));
    expect(within(card).getByText('2')).toBeInTheDocument();
  });

  it('shows one real Booking Issues pill and three honest unavailable pills in the attention strip', async () => {
    mockFetch();
    renderCC();

    await waitFor(() => {
      expect(screen.getByText(/Booking Issues/)).toBeInTheDocument();
    });

    expect(screen.getByText(/Attendance Issues/)).toBeInTheDocument();
    expect(screen.getAllByText(/Payroll Pending/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Low Stock Alerts/)).toBeInTheDocument();
  });

  it('renders a real alert-derived status pill in Live Branch Activity, but never a fabricated "Ramai" busy tier', async () => {
    mockFetch();
    renderCC();

    // Wait for the real per-branch row content specifically (not just the branch-selector
    // <option>, which renders earlier and would make this assertion resolve prematurely).
    await waitFor(() => {
      expect(screen.getByText('30 booking hari ini')).toBeInTheDocument();
    });

    expect(screen.getAllByText('CSB').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pondok Indah').length).toBeGreaterThan(0);
    // CSB's fixture carries a real alert → "Perlu Perhatian"; PDK has none → "Normal".
    // Both are derived straight from the real alerts[] payload, not invented.
    expect(screen.getByText('Perlu Perhatian')).toBeInTheDocument();
    expect(screen.getByText('Normal')).toBeInTheDocument();
    // No busy-volume tier: there is no defined threshold for "Ramai", so it must never appear.
    expect(screen.queryByText('Ramai')).not.toBeInTheDocument();
  });

  it('does not blank the page when one branch fetch fails', async () => {
    mockFetch({ branchFailFor: ['pdk'] });
    renderCC();

    await waitFor(() => {
      expect(screen.getByText('CSB')).toBeInTheDocument();
    });
    expect(screen.getByText('Command Center')).toBeInTheDocument();
  });

  it('renders a real pending-booking action item in Action Center', async () => {
    mockFetch();
    renderCC();

    await waitFor(() => {
      expect(screen.getByText(/booking menunggu konfirmasi/i)).toBeInTheDocument();
    });
  });

  it('renders a real Moka sync error in Alerts & Exceptions', async () => {
    mockFetch();
    renderCC();

    await waitFor(() => {
      expect(screen.getByText('Alerts & Exceptions')).toBeInTheDocument();
    });
    expect(screen.getByText(/Outlet token expired/i)).toBeInTheDocument();
  });

  it('renders real Moka sync activity in Today\'s Operations Timeline', async () => {
    mockFetch();
    renderCC();

    await waitFor(() => {
      expect(screen.getByText("Today's Operations Timeline")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/transaction|booking/i).length).toBeGreaterThan(0);
  });

  it('shows UNAVAILABLE on Inventory and Payroll business snapshots, and real data on the rest', async () => {
    mockFetch();
    renderCC();

    await waitFor(() => {
      expect(screen.getByText('Business Snapshots')).toBeInTheDocument();
    });

    const inventoryCard = cardOf(screen.getByText('Inventory Snapshot'));
    expect(within(inventoryCard).getByText(/UNAVAILABLE/i)).toBeInTheDocument();

    const payrollCard = cardOf(screen.getByText('Payroll Snapshot'));
    expect(within(payrollCard).getByText(/UNAVAILABLE/i)).toBeInTheDocument();

    const customerCard = cardOf(screen.getByText('Customer Snapshot'));
    expect(within(customerCard).getByText('731')).toBeInTheDocument();
  });

  it('filters Today\'s Operations Timeline to the Asia/Jakarta calendar day, excluding entries from yesterday', async () => {
    mockFetch({
      mokaLogs: {
        logs: [
          { id: 'today1', direction: 'pull', entity_type: 'transaction', entity_id: 't1', status: 'ok', error_message: null, retry_count: 0, created_at: TODAY_ISO },
          { id: 'yesterday1', direction: 'pull', entity_type: 'refund', entity_id: 'r1', status: 'ok', error_message: null, retry_count: 0, created_at: YESTERDAY_ISO },
        ],
      },
    });
    renderCC();

    await waitFor(() => {
      expect(screen.getByText(/Sinkronisasi pull transaction/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Sinkronisasi pull refund/i)).not.toBeInTheDocument();
  });

  it("renders the Today's Operations Timeline clock in Asia/Jakarta time, not browser/system local time, across a UTC/Jakarta date boundary", async () => {
    // Jakarta has a fixed UTC+7 offset (no DST), so Jakarta midnight of "today" is
    // representable directly as an ISO string with an explicit +07:00 offset.
    const jakartaToday = NOW.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const jakartaMidnightUtcMs = new Date(`${jakartaToday}T00:00:00+07:00`).getTime();
    // Jakarta 02:15 today — 7 hours earlier in UTC, which lands on the PREVIOUS UTC
    // calendar date (19:15 UTC the day before). Passes the Timeline's Jakarta-day filter
    // while crossing the UTC/Jakarta date boundary, so a browser/UTC-local clock would
    // render "19.15" instead of the correct "02.15" (id-ID formats hh.mm with a dot).
    const boundaryIso = new Date(jakartaMidnightUtcMs + (2 * 60 + 15) * 60 * 1000).toISOString();

    // This machine's own system-local timezone happens to already be Asia/Jakarta, which
    // would silently mask a missing `timeZone: OPERATIONAL_TIMEZONE` (both would render the
    // same). Force system-local to UTC for this test so an omitted/wrong timeZone would
    // provably render the wrong clock ("19.15") instead of coincidentally matching.
    const originalTz = process.env.TZ;
    process.env.TZ = 'UTC';

    try {
      mockFetch({
        mokaLogs: {
          logs: [
            { id: 'boundary1', direction: 'pull', entity_type: 'transaction', entity_id: 't1', status: 'ok', error_message: null, retry_count: 0, created_at: boundaryIso },
          ],
        },
      });
      renderCC();

      await waitFor(() => {
        expect(screen.getByText(/02[.:]15/)).toBeInTheDocument();
      });
      expect(screen.queryByText(/19[.:]15/)).not.toBeInTheDocument();
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it("shows the empty state in Today's Operations Timeline once all fetched logs fall outside today's Jakarta calendar day", async () => {
    mockFetch({
      mokaLogs: {
        logs: [
          { id: 'yesterday1', direction: 'pull', entity_type: 'transaction', entity_id: 't1', status: 'ok', error_message: null, retry_count: 0, created_at: YESTERDAY_ISO },
        ],
      },
    });
    renderCC();

    await waitFor(() => {
      expect(screen.getByText('Belum ada aktivitas sinkronisasi hari ini.')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Sinkronisasi pull transaction/i)).not.toBeInTheDocument();
  });

  it('computes the Active Members "bulan ini" trend from membership_activated_at on ACTIVE members only, not created_at', async () => {
    mockFetch({
      membership: [
        // Activated this month, ACTIVE — should count.
        { user_key: 'u1', full_name: 'Budi', email: 'budi@example.com', membership_status: 'ACTIVE', membership_activated_at: TODAY_ISO, membership_started_at: null, membership_expires_at: null, current_tier: 'gold', total_points: 100, total_visits: 5, created_at: LAST_MONTH_ISO, phone: '+6281', last_visit: '2026-08-30' },
        // created_at this month but activated_at last month — must NOT count (created_at is not a valid proxy).
        { user_key: 'u2', full_name: 'Sari', email: 'sari@example.com', membership_status: 'ACTIVE', membership_activated_at: LAST_MONTH_ISO, membership_started_at: null, membership_expires_at: null, current_tier: 'silver', total_points: 0, total_visits: 1, created_at: TODAY_ISO, phone: '+6282', last_visit: '2026-07-10' },
        // Activated this month but INACTIVE — must NOT count.
        { user_key: 'u3', full_name: 'Wati', email: 'wati@example.com', membership_status: 'INACTIVE', membership_activated_at: TODAY_ISO, membership_started_at: null, membership_expires_at: null, current_tier: 'bronze', total_points: 20, total_visits: 2, created_at: LAST_MONTH_ISO, phone: '+6283', last_visit: '2026-08-20' },
      ],
    });
    renderCC();

    await waitFor(() => {
      expect(screen.getByText('+1 bulan ini')).toBeInTheDocument();
    });
  });

  it('discloses that Active Members is a network-wide figure once a specific branch is selected, without fabricating a branch-scoped number', async () => {
    mockFetch();
    renderCC();

    await waitFor(() => {
      expect(screen.getByLabelText('Cabang')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Seluruh Cabang/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Cabang'), { target: { value: 'csb' } });

    await waitFor(() => {
      expect(screen.getByText(/Seluruh Cabang — belum ada atribusi cabang/i)).toBeInTheDocument();
    });

    const card = cardOf(screen.getByText('Active Members'));
    expect(within(card).getByText('2')).toBeInTheDocument();
  });
});
