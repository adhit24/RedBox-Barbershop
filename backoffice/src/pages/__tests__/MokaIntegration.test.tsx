import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MokaIntegration } from '../MokaIntegration';

const STATUS = {
  oauthConfigured: true,
  outlets: [
    { id: 'o1', name: 'CSB', slug: 'csb', mokaOutletId: 'm1', hasToken: true, tokenExpiry: '2027-01-01', tokenExpired: false },
    { id: 'o2', name: 'Bypass', slug: 'bypass', mokaOutletId: 'm2', hasToken: true, tokenExpiry: '2027-01-01', tokenExpired: false },
  ],
  recentLogs: [],
};

const LOGS = {
  logs: [
    { id: 'l1', direction: 'CSB', entity_type: 'transaction', entity_id: 'tx1', status: 'ok', error_message: null, retry_count: 0, created_at: '2026-09-01T08:46:00.000Z' },
    { id: 'l2', direction: 'Samadikun', entity_type: 'item_mapping', entity_id: null, status: 'error', error_message: 'SKU tidak ditemukan', retry_count: 1, created_at: '2026-09-01T08:30:00.000Z' },
    { id: 'l3', direction: 'Sumber', entity_type: 'open_bill', entity_id: null, status: 'error', error_message: 'Menunggu respon Moka', retry_count: 1, created_at: '2026-09-01T08:28:00.000Z' },
    { id: 'l4', direction: 'Semua outlet', entity_type: 'customer', entity_id: null, status: 'ok', error_message: null, retry_count: 0, created_at: '2026-09-01T08:15:00.000Z' },
  ],
};

function mockFetch() {
  const fetchMock = fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('sync-logs')) return Promise.resolve(new Response(JSON.stringify(LOGS), { status: 200 }));
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

  it('removes the old standalone Status Outlet section', async () => {
    mockFetch();
    render(<MokaIntegration />);
    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument());
    expect(screen.queryByText('Status Outlet')).not.toBeInTheDocument();
  });

  it('keeps unsupported barber mapping honest', async () => {
    mockFetch();
    render(<MokaIntegration />);
    await waitFor(() => expect(screen.getByText('Barber Mapping')).toBeInTheDocument());
    expect(screen.getByText(/data barber mapping belum tersedia/i)).toBeInTheDocument();
  });

  it('still renders real sync-log errors', async () => {
    mockFetch();
    render(<MokaIntegration />);
    await waitFor(() => expect(screen.getByText(/SKU tidak ditemukan/i)).toBeInTheDocument());
  });
});
