import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MokaIntegration } from '../MokaIntegration';

const STATUS = {
  oauthConfigured: true,
  outlets: [
    { id: 'o1', name: 'CSB', slug: 'csb', mokaOutletId: 'm1', hasToken: true, tokenExpiry: '2027-01-01', tokenExpired: false },
    { id: 'o2', name: 'Bypass', slug: 'bypass', mokaOutletId: 'm2', hasToken: true, tokenExpiry: '2027-01-01', tokenExpired: false },
  ],
  recentLogs: [],
};

const LOGS_MIXED = {
  logs: [
    { id: 'l1', direction: 'CSB', entity_type: 'transaction', entity_id: 'tx1', status: 'success', error_message: null, retry_count: 0, created_at: '2026-09-01T08:46:00.000Z' },
    { id: 'l2', direction: 'Samadikun', entity_type: 'item_mapping', entity_id: null, status: 'error', error_message: 'SKU tidak ditemukan', retry_count: 1, created_at: '2026-09-01T08:30:00.000Z' },
    { id: 'l3', direction: 'Sumber', entity_type: 'open_bill', entity_id: null, status: 'error', error_message: 'Menunggu respon Moka', retry_count: 1, created_at: '2026-09-01T08:28:00.000Z' },
    { id: 'l4', direction: 'Semua outlet', entity_type: 'customer', entity_id: null, status: 'ok', error_message: null, retry_count: 0, created_at: '2026-09-01T08:15:00.000Z' },
  ],
};

const BRANCH_HEALTH = {
  branches: [
    {
      outletId: 'o1',
      name: 'RedBox CSB Mall',
      slug: 'csb',
      mokaOutletId: '216102',
      hasToken: true,
      tokenExpiresAt: '2026-12-10T16:54:52.624Z',
      tokenExpired: false,
      lastSuccessfulSyncAt: '2026-09-08T17:01:29.390Z',
      lastStartedAt: '2026-09-08T19:00:36.877Z',
      lastStatus: 'RUNNING',
      lastError: null,
      healthState: 'PARTIAL',
      attentionReason: '44 item belum terpetakan',
      stats: { fetched: 415, unmapped: 44, anomalies: 41, processed: 0, qtyDeducted: 0, skippedDuplicate: 11 },
    },
    {
      outletId: 'o2',
      name: 'RedBox Bypass',
      slug: 'bypass',
      mokaOutletId: '100818',
      hasToken: true,
      tokenExpiresAt: '2027-01-20T13:10:32.438Z',
      tokenExpired: false,
      lastSuccessfulSyncAt: '2026-09-08T19:01:09.719Z',
      lastStartedAt: '2026-09-08T19:00:36.962Z',
      lastStatus: 'SUCCESS',
      lastError: null,
      healthState: 'HEALTHY',
      attentionReason: null,
      stats: { fetched: 244, unmapped: 0, anomalies: 0, processed: 1, qtyDeducted: 1, skippedDuplicate: 13 },
    },
    {
      outletId: 'o3',
      name: 'RedBox Samadikun',
      slug: 'samadikun',
      mokaOutletId: '105517',
      hasToken: true,
      tokenExpiresAt: '2026-01-01T00:00:00.000Z',
      tokenExpired: true,
      lastSuccessfulSyncAt: '2026-09-08T10:00:00.000Z',
      lastStartedAt: null,
      lastStatus: 'FAILED',
      lastError: null,
      healthState: 'TOKEN_EXPIRED',
      attentionReason: 'Token Moka telah kedaluwarsa',
      stats: null,
    },
    {
      outletId: 'o4',
      name: 'RedBox Sumber',
      slug: 'sumber',
      mokaOutletId: '592422',
      hasToken: true,
      tokenExpiresAt: '2027-01-01T00:00:00.000Z',
      tokenExpired: false,
      lastSuccessfulSyncAt: '2026-09-08T10:00:00.000Z',
      lastStartedAt: null,
      lastStatus: 'SUCCESS',
      lastError: null,
      healthState: 'DELAYED',
      attentionReason: 'Sinkronisasi terakhir lebih dari 2 jam lalu',
      stats: null,
    },
  ],
};

function mockFetch(options: { branchHealth?: typeof BRANCH_HEALTH; logs?: typeof LOGS_MIXED } = {}) {
  const fetchMock = fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('branch-health')) {
      return Promise.resolve(new Response(JSON.stringify(options.branchHealth ?? BRANCH_HEALTH), { status: 200 }));
    }
    if (url.includes('sync-logs')) {
      return Promise.resolve(new Response(JSON.stringify(options.logs ?? LOGS_MIXED), { status: 200 }));
    }
    if (url.includes('status')) {
      return Promise.resolve(new Response(JSON.stringify(STATUS), { status: 200 }));
    }
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

  it('renders production success status as successful (berhasil) and active', async () => {
    mockFetch();
    render(<MokaIntegration />);
    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument());

    // Both 'success' and 'ok' should render 'berhasil'
    await waitFor(() => {
      expect(screen.getByText(/Transaction sync — CSB berhasil/i)).toBeInTheDocument();
      expect(screen.getByText(/Customer sync — Semua outlet berhasil/i)).toBeInTheDocument();
    });
  });

  it('renders branch health section with states (Healthy, Partial, Token Expired, Delayed)', async () => {
    mockFetch();
    render(<MokaIntegration />);
    await waitFor(() => expect(screen.getByText('Kesehatan Sinkronisasi Cabang')).toBeInTheDocument());

    // Verify branch names rendered
    expect(screen.getByText('RedBox CSB Mall')).toBeInTheDocument();
    expect(screen.getByText('RedBox Bypass')).toBeInTheDocument();
    expect(screen.getByText('RedBox Samadikun')).toBeInTheDocument();
    expect(screen.getByText('RedBox Sumber')).toBeInTheDocument();

    // Verify health badges scoped to each branch card
    const csbCard = screen.getByTestId('branch-health-csb');
    expect(within(csbCard).getByText('Partial')).toBeInTheDocument();
    expect(within(csbCard).getByText(/44 item belum terpetakan/i)).toBeInTheDocument();

    const bypassCard = screen.getByTestId('branch-health-bypass');
    expect(within(bypassCard).getByText('Healthy')).toBeInTheDocument();

    const samadikunCard = screen.getByTestId('branch-health-samadikun');
    expect(within(samadikunCard).getByText('Token Expired')).toBeInTheDocument();
    expect(within(samadikunCard).getByText(/Token Moka telah kedaluwarsa/i)).toBeInTheDocument();

    const sumberCard = screen.getByTestId('branch-health-sumber');
    expect(within(sumberCard).getByText('Delayed')).toBeInTheDocument();
  });

  it('confirms NO Sync Now or manual sync trigger exists', async () => {
    mockFetch();
    render(<MokaIntegration />);
    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument());

    expect(screen.queryByText(/Sync Now/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sinkron Sekarang/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Trigger Sync/i)).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getAllByText(/SKU tidak ditemukan/i).length).toBeGreaterThan(0));
  });
});
