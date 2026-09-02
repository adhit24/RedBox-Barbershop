import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BookingPerformance } from '../BookingPerformance';

function renderPage() {
  return render(<BookingPerformance />, { wrapper: MemoryRouter });
}

function cardOf(text: HTMLElement): HTMLElement {
  const card = text.closest<HTMLElement>('.rounded-rb-card');
  if (!card) throw new Error('No .rounded-rb-card ancestor found');
  return card;
}

const OWNER_OVERVIEW = {
  today: '2026-09-01',
  branches: [
    { slug: 'csb', name: 'CSB', revenue_moka: 0, tx_moka: 0, revenue_web: 0, tx_web: 0, hadir: 0, total_barbers: 0, goshow: 0, pending_bookings: 0 },
    { slug: 'bypass', name: 'Bypass', revenue_moka: 0, tx_moka: 0, revenue_web: 0, tx_web: 0, hadir: 0, total_barbers: 0, goshow: 0, pending_bookings: 0 },
  ],
  totals: { revenue_moka: 0, revenue_web: 0, tx_total: 0, hadir: 0, goshow: 0, pending: 0 },
};

const CSB_DATA = {
  today: '2026-09-01',
  barbers: [],
  stats: { hadir: 0, tidak_hadir: 0, belum_check_in: 0, booking_today: 5, pending: 2, home_service_active: 0, moka_open_bills: 0 },
  home_service: [],
  booking_feed: [
    { id: 'bk1', status: 'pending', time: '09:30', barber_id: null, name: 'Budi', wa: null, service: 'Haircut', notes: null },
    { id: 'bk2', status: 'confirmed', time: '13:00', barber_id: null, name: 'Sari', wa: null, service: 'Haircut', notes: null },
    { id: 'bk3', status: 'confirmed', time: '19:15', barber_id: null, name: 'Rina', wa: null, service: 'Haircut', notes: null },
  ],
  moka_open_bills: [],
  alerts: [],
};

const BYPASS_DATA = {
  today: '2026-09-01',
  barbers: [],
  stats: { hadir: 0, tidak_hadir: 0, belum_check_in: 0, booking_today: 3, pending: 1, home_service_active: 0, moka_open_bills: 0 },
  home_service: [],
  booking_feed: [{ id: 'bk4', status: 'pending', time: '10:15', barber_id: null, name: 'Dedi', wa: null, service: 'Shave', notes: null }],
  moka_open_bills: [],
  alerts: [],
};

function mockFetch(overrides: { branchFailFor?: string[] } = {}) {
  const fetchMock = fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('owner-overview')) {
      return Promise.resolve(new Response(JSON.stringify(OWNER_OVERVIEW), { status: 200 }));
    }
    if (url.includes('branch=csb')) {
      if (overrides.branchFailFor?.includes('csb')) return Promise.resolve(new Response('fail', { status: 500 }));
      return Promise.resolve(new Response(JSON.stringify(CSB_DATA), { status: 200 }));
    }
    if (url.includes('branch=bypass')) {
      if (overrides.branchFailFor?.includes('bypass')) return Promise.resolve(new Response('fail', { status: 500 }));
      return Promise.resolve(new Response(JSON.stringify(BYPASS_DATA), { status: 200 }));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
}

describe('BookingPerformance', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a real cross-branch total booking count', async () => {
    mockFetch();
    renderPage();

    await waitFor(() => {
      // "Total Booking" also appears as a table column header — the KPI label renders first.
      const card = cardOf(screen.getAllByText('Total Booking')[0]);
      // CSB booking_today 5 + Bypass booking_today 3 = 8
      expect(within(card).getByText('8')).toBeInTheDocument();
    });
  });

  it('shows a real cross-branch confirmed/upcoming count derived from booking_feed status', async () => {
    mockFetch();
    renderPage();

    await waitFor(() => {
      const card = cardOf(screen.getByText('Upcoming / Confirmed'));
      // confirmed: bk2, bk3 (CSB) = 2
      expect(within(card).getByText('2')).toBeInTheDocument();
    });
  });

  it('shows honest unavailable states for Completed and Cancelled, never a fabricated number', async () => {
    mockFetch();
    renderPage();

    await waitFor(() => {
      // "Completed"/"Cancelled" also appear as table column headers — the KPI label renders first.
      const completedCard = cardOf(screen.getAllByText('Completed')[0]);
      expect(within(completedCard).getByText(/belum tersedia/i)).toBeInTheDocument();
    });
    const cancelledCard = cardOf(screen.getAllByText('Cancelled')[0]);
    expect(within(cancelledCard).getByText(/belum tersedia/i)).toBeInTheDocument();
  });

  it('renders a real per-branch table with an honest unavailable Completion Rate', async () => {
    mockFetch();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('CSB')).toBeInTheDocument();
    });
    expect(screen.getByText('Bypass')).toBeInTheDocument();
    expect(screen.getAllByText(/belum tersedia/i).length).toBeGreaterThan(0);
  });

  it('buckets real booking times into a simple time-of-day pattern', async () => {
    mockFetch();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Pagi (< 11:00)')).toBeInTheDocument();
    });
    // 09:30 (CSB) + 10:15 (Bypass) = 2 in the morning bucket
    const morningRow = screen.getByText('Pagi (< 11:00)').closest('div')!.parentElement!;
    expect(within(morningRow).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Malam (≥ 18:00)')).toBeInTheDocument();
  });

  it('does not blank the page when one branch fails to load', async () => {
    mockFetch({ branchFailFor: ['bypass'] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('CSB')).toBeInTheDocument();
    });
    expect(screen.getByText(/Gagal memuat data untuk: Bypass/i)).toBeInTheDocument();
  });
});
