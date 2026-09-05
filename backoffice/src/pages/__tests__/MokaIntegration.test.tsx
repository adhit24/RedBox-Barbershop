import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MokaIntegration } from '../MokaIntegration';

const STATUS = {
  oauthConfigured: true,
  outlets: [
    { id: 'o1', name: 'CSB', slug: 'csb', mokaOutletId: 'm1', hasToken: true, tokenExpiry: '2027-01-01', tokenExpired: false },
    { id: 'o2', name: 'Bypass', slug: 'bypass', mokaOutletId: 'm2', hasToken: true, tokenExpiry: '2027-01-01', tokenExpired: false },
  ],
  recentLogs: [],
};

// Real entity_type/status values, matching what server/moka/sync.js actually
// writes to sync_logs — see server/moka/health.js's header comment and the
// ENTITY_LABEL map in MokaIntegration.tsx.
const LOGS = {
  logs: [
    { id: 'l1', direction: 'moka_to_web', entity_type: 'order', entity_id: 'tx1', status: 'success', error_message: null, retry_count: 0, created_at: '2026-09-01T08:46:00.000Z' },
    { id: 'l2', direction: 'moka_to_web', entity_type: 'moka_open_bills', entity_id: null, status: 'failed', error_message: 'SKU tidak ditemukan', retry_count: 1, created_at: '2026-09-01T08:30:00.000Z' },
  ],
};

const HEALTH = {
  today: '2026-09-01',
  outlets: [
    { outletId: 'o1', slug: 'csb', name: 'CSB', connected: true, health: 'healthy', lastSuccessfulSync: '2026-09-01T08:46:00.000Z', transactionsToday: 12, unmatchedTransactionsToday: 0 },
    { outletId: 'o2', slug: 'bypass', name: 'Bypass', connected: true, health: 'expired', lastSuccessfulSync: null, transactionsToday: 0, unmatchedTransactionsToday: 3 },
  ],
};

function mockFetch() {
  const fetchMock = fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('sync-logs')) return Promise.resolve(new Response(JSON.stringify(LOGS), { status: 200 }));
    if (url.includes('/api/moka/health')) return Promise.resolve(new Response(JSON.stringify(HEALTH), { status: 200 }));
    if (url.includes('status')) return Promise.resolve(new Response(JSON.stringify(STATUS), { status: 200 }));
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
}

describe('MokaIntegration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the connected summary and six operational sync cards', async () => {
    mockFetch();
    render(<MokaIntegration />);
    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument());

    expect(screen.getByText('Transaction Sync')).toBeInTheDocument();
    expect(screen.getByText('Customer Sync')).toBeInTheDocument();
    expect(screen.getByText('Item Mapping')).toBeInTheDocument();
    expect(screen.getByText('Barber Mapping')).toBeInTheDocument();
    expect(screen.getByText('Open Bill / Schedule Sync')).toBeInTheDocument();
    expect(screen.getByText('Last Successful Sync')).toBeInTheDocument();
  });

  it('keeps unsupported barber/customer/item-mapping cards honestly unavailable — no fictional entity_type match', async () => {
    mockFetch();
    render(<MokaIntegration />);
    await waitFor(() => expect(screen.getByText('Barber Mapping')).toBeInTheDocument());
    expect(screen.getByText(/data barber mapping belum tersedia/i)).toBeInTheDocument();
    expect(screen.getByText('Belum ada data customer sync')).toBeInTheDocument();
    expect(screen.getByText('Belum ada data item mapping')).toBeInTheDocument();
  });

  it('renders a real transaction sync log entry as successful, not failed — status is "success" not "ok"', async () => {
    mockFetch();
    render(<MokaIntegration />);
    await waitFor(() => expect(screen.getAllByText(/Transaction sync/i).length).toBeGreaterThan(0));
    expect(screen.getByText(/Transaction sync — moka_to_web berhasil/i)).toBeInTheDocument();
  });

  it('still renders real sync-log errors with the correct real entity label', async () => {
    mockFetch();
    render(<MokaIntegration />);
    // Appears twice by design: once on the Open Bill / Schedule Sync card's
    // detail line, once in the raw Sync Logs list below it.
    await waitFor(() => expect(screen.getAllByText(/SKU tidak ditemukan/i).length).toBeGreaterThan(0));
    expect(screen.getByText(/Open bill sync — moka_to_web gagal/i)).toBeInTheDocument();
  });

  it('shows a Health Status per Cabang panel with a real health badge per outlet, no fabricated statuses', async () => {
    mockFetch();
    render(<MokaIntegration />);
    await waitFor(() => expect(screen.getByText('Health Status per Cabang')).toBeInTheDocument());

    const csbRow = screen.getByText('CSB').closest('div')!.parentElement!.parentElement!;
    expect(within(csbRow).getByText('Healthy')).toBeInTheDocument();
    expect(within(csbRow).getByText('12 transaksi hari ini')).toBeInTheDocument();

    const bypassRow = screen.getByText('Bypass').closest('div')!.parentElement!.parentElement!;
    expect(within(bypassRow).getByText('Expired')).toBeInTheDocument();
    expect(within(bypassRow).getByText('3 belum matched')).toBeInTheDocument();
  });

  it('never renders a raw token value or a raw technical error anywhere on the page', async () => {
    mockFetch();
    const { container } = render(<MokaIntegration />);
    await waitFor(() => expect(screen.getByText('Health Status per Cabang')).toBeInTheDocument());
    expect(container.innerHTML.includes('access_token')).toBe(false);
    expect(container.innerHTML.includes('Bearer ')).toBe(false);
  });

  it('triggers a real sync via the Sync Now button and shows a result message', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('sync-transactions') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ message: 'ok', results: [{ slug: 'csb', processed: 4, skipped: 0, errors: 0 }] }), { status: 200 }));
      }
      if (url.includes('sync-logs')) return Promise.resolve(new Response(JSON.stringify(LOGS), { status: 200 }));
      if (url.includes('/api/moka/health')) return Promise.resolve(new Response(JSON.stringify(HEALTH), { status: 200 }));
      if (url.includes('status')) return Promise.resolve(new Response(JSON.stringify(STATUS), { status: 200 }));
      return Promise.resolve(new Response('not found', { status: 404 }));
    });
    render(<MokaIntegration />);
    await waitFor(() => expect(screen.getByText('Sync Now')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Sync Now'));

    await waitFor(() => expect(screen.getByText(/4 transaksi diproses/i)).toBeInTheDocument());
  });
});
