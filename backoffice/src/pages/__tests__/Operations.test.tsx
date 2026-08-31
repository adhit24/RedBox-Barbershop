import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Operations } from '../Operations';

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
  barbers: [{ id: 'b1', name: 'Ubay', branch: 'csb', attendance_status: 'hadir', today_count: 3 }],
  stats: { hadir: 1, tidak_hadir: 0, belum_check_in: 0, booking_today: 2, pending: 1, home_service_active: 0, moka_open_bills: 0 },
  home_service: [],
  booking_feed: [{ id: 'bk1', status: 'pending', time: '10:00', barber_id: 'b1', name: 'Budi', wa: '+6281', service: 'Haircut', notes: null }],
  moka_open_bills: [],
  alerts: [],
};

const BYPASS_DATA = {
  today: '2026-09-01',
  barbers: [{ id: 'b2', name: 'Sari', branch: 'bypass', attendance_status: null, today_count: 0 }],
  stats: { hadir: 0, tidak_hadir: 0, belum_check_in: 1, booking_today: 0, pending: 0, home_service_active: 0, moka_open_bills: 0 },
  home_service: [],
  booking_feed: [],
  moka_open_bills: [],
  alerts: [],
};

function mockFetchSequence() {
  const fetchMock = fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('owner-overview')) {
      return Promise.resolve(new Response(JSON.stringify(OWNER_OVERVIEW), { status: 200 }));
    }
    if (url.includes('branch=csb')) {
      return Promise.resolve(new Response(JSON.stringify(CSB_DATA), { status: 200 }));
    }
    if (url.includes('branch=bypass')) {
      return Promise.resolve(new Response(JSON.stringify(BYPASS_DATA), { status: 200 }));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
}

describe('Operations', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('merges the booking feed across branches and shows the customer name', async () => {
    mockFetchSequence();
    render(<Operations />);

    await waitFor(() => {
      expect(screen.getByText('Budi')).toBeInTheDocument();
    });
  });

  it('resolves the barber name from the matching branch roster', async () => {
    mockFetchSequence();
    render(<Operations />);

    await waitFor(() => {
      expect(screen.getByText('Budi')).toBeInTheDocument();
    });
    expect(screen.getByText('Ubay')).toBeInTheDocument();
  });

  it('renders the barber-on-duty roster merged across branches', async () => {
    mockFetchSequence();
    render(<Operations />);

    await waitFor(() => {
      expect(screen.getAllByText('Ubay').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Sari')).toBeInTheDocument();
  });

  it('shows a total booking-today count derived from real per-branch stats', async () => {
    mockFetchSequence();
    render(<Operations />);

    await waitFor(() => {
      // CSB booking_today: 2, Bypass booking_today: 0 -> total 2
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  it('does not blank the whole page when one branch fails to load', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('owner-overview')) {
        return Promise.resolve(new Response(JSON.stringify(OWNER_OVERVIEW), { status: 200 }));
      }
      if (url.includes('branch=csb')) {
        return Promise.resolve(new Response(JSON.stringify(CSB_DATA), { status: 200 }));
      }
      if (url.includes('branch=bypass')) {
        return Promise.resolve(new Response('server exploded', { status: 500 }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    });

    render(<Operations />);

    await waitFor(() => {
      expect(screen.getByText('Budi')).toBeInTheDocument();
    });
    expect(screen.getByText(/Bypass/i)).toBeInTheDocument();
  });
});
