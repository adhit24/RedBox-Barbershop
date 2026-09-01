import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiClient,
  storeToken,
  clearToken,
  onUnauthorized,
  ApiError,
} from '../apiClient';

describe('apiClient', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
  });

  it('attaches the x-admin-token header when a token is stored', async () => {
    storeToken('secret-token');
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await apiClient.get('/api/test');

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.headers as Headers).get('x-admin-token')).toBe('secret-token');
  });

  it('does not attach the x-admin-token header when no token is stored', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await apiClient.get('/api/test');

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.headers as Headers).has('x-admin-token')).toBe(false);
  });

  it('notifies onUnauthorized listeners and throws ApiError on a 401 response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('', { status: 401 })
    );
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);

    await expect(apiClient.get('/api/test')).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('throws ApiError carrying the response status for other non-ok responses', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('server exploded', { status: 500 })
    );

    await expect(apiClient.get('/api/test')).rejects.toMatchObject({ status: 500 });
  });

  it('resolves with the parsed JSON body on success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ hello: 'world' }), { status: 200 })
    );

    const result = await apiClient.get<{ hello: string }>('/api/test');

    expect(result).toEqual({ hello: 'world' });
  });
});
