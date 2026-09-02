import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMokaStatus, getMokaSyncLogs, getMokaHealth, postSyncTransactions } from '../moka';

describe('moka service', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getMokaStatus calls GET /api/moka/status', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ oauthConfigured: true, outlets: [], recentLogs: [] }), { status: 200 })
    );

    const result = await getMokaStatus();

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/moka/status');
    expect(result.oauthConfigured).toBe(true);
  });

  it('getMokaSyncLogs calls GET /api/moka/sync-logs with no params by default', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ logs: [] }), { status: 200 })
    );
    await getMokaSyncLogs({});
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/moka/sync-logs');
  });

  it('getMokaSyncLogs passes through limit', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ logs: [] }), { status: 200 })
    );
    await getMokaSyncLogs({ limit: 20 });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/moka/sync-logs?limit=20');
  });

  it('getMokaHealth calls GET /api/moka/health with no branch/outlet param — scope comes from the server session', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ today: '2026-09-02', outlets: [] }), { status: 200 })
    );
    const result = await getMokaHealth();
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/moka/health');
    expect(result.today).toBe('2026-09-02');
  });

  it('postSyncTransactions calls POST /api/moka/sync-transactions with an empty body when no outlet is given', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ message: 'ok', results: [] }), { status: 200 })
    );
    await postSyncTransactions();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/moka/sync-transactions');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
  });

  it('postSyncTransactions passes the outlet slug through in the body', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ message: 'ok', results: [] }), { status: 200 })
    );
    await postSyncTransactions('csb');
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ outlet: 'csb' });
  });
});
