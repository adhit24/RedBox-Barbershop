import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AttendanceReport } from '../AttendanceReport';

function renderPage() {
  return render(<AttendanceReport />, { wrapper: MemoryRouter });
}

function cardOf(text: HTMLElement): HTMLElement {
  const card = text.closest<HTMLElement>('.rounded-rb-card');
  if (!card) throw new Error('No .rounded-rb-card ancestor found');
  return card;
}

const OWNER_OVERVIEW = {
  today: '2026-09-01',
  branches: [
    { slug: 'csb', name: 'CSB', revenue_moka: 0, tx_moka: 0, revenue_web: 0, tx_web: 0, hadir: 0, total_barbers: 5, goshow: 0, pending_bookings: 0 },
    { slug: 'bypass', name: 'Bypass', revenue_moka: 0, tx_moka: 0, revenue_web: 0, tx_web: 0, hadir: 0, total_barbers: 4, goshow: 0, pending_bookings: 0 },
  ],
  totals: { revenue_moka: 0, revenue_web: 0, tx_total: 0, hadir: 0, goshow: 0, pending: 0 },
};

const CSB_DATA = {
  today: '2026-09-01',
  barbers: [
    { id: 'b1', name: 'Ubay', branch: 'csb', attendance_status: 'hadir', today_count: 3 },
    { id: 'b2', name: 'Dedi', branch: 'csb', attendance_status: 'terlambat', today_count: 1 },
  ],
  stats: { hadir: 3, tidak_hadir: 1, belum_check_in: 1, booking_today: 5, pending: 2, home_service_active: 0, moka_open_bills: 0 },
  home_service: [],
  booking_feed: [],
  moka_open_bills: [],
  alerts: [],
};

const BYPASS_DATA = {
  today: '2026-09-01',
  barbers: [{ id: 'b3', name: 'Sari', branch: 'bypass', attendance_status: 'hadir', today_count: 2 }],
  stats: { hadir: 2, tidak_hadir: 0, belum_check_in: 2, booking_today: 3, pending: 1, home_service_active: 0, moka_open_bills: 0 },
  home_service: [],
  booking_feed: [],
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

describe('AttendanceReport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows real cross-branch Hadir/Terlambat/Tidak Hadir totals', async () => {
    mockFetch();
    renderPage();

    await waitFor(() => {
      const hadirCard = cardOf(screen.getAllByText('Hadir')[0]);
      // CSB hadir 3 + Bypass hadir 2 = 5
      expect(within(hadirCard).getByText('5')).toBeInTheDocument();
    });

    const terlambatCard = cardOf(screen.getAllByText('Terlambat')[0]);
    // Only Dedi (CSB) is terlambat = 1
    expect(within(terlambatCard).getByText('1')).toBeInTheDocument();

    const tidakHadirCard = cardOf(screen.getAllByText('Tidak Hadir')[0]);
    // CSB tidak_hadir 1 + Bypass tidak_hadir 0 = 1
    expect(within(tidakHadirCard).getByText('1')).toBeInTheDocument();
  });

  it('shows an honest unavailable state for Attendance Exceptions, never a fabricated number', async () => {
    mockFetch();
    renderPage();

    await waitFor(() => {
      const card = cardOf(screen.getByText('Attendance Exceptions'));
      expect(within(card).getByText(/belum tersedia/i)).toBeInTheDocument();
    });
  });

  it('renders a real per-branch table with real Karyawan counts and honest unavailable Exception column', async () => {
    mockFetch();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('CSB')).toBeInTheDocument();
    });

    const csbRow = screen.getByText('CSB').closest('div')!.parentElement!;
    // total_barbers for CSB is 5
    expect(within(csbRow).getByText('5')).toBeInTheDocument();

    const bypassRow = screen.getByText('Bypass').closest('div')!.parentElement!;
    // total_barbers for Bypass is 4
    expect(within(bypassRow).getByText('4')).toBeInTheDocument();

    expect(screen.getAllByText(/belum tersedia/i).length).toBeGreaterThan(0);
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
