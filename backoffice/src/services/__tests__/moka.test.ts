import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMokaStatus, getMokaSyncLogs } from '../moka';

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
});
