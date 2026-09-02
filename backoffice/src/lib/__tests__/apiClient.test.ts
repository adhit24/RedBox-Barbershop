import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSession = vi.fn();

vi.mock('../supabase', () => ({
  supabase: {
    auth: { getSession },
  },
}));

import {
  apiClient,
  onUnauthorized,
  ApiError,
} from '../apiClient';

describe('apiClient', () => {
  beforeEach(() => {
    getSession.mockReset();
    getSession.mockResolvedValue({ data: { session: null } });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches the Supabase access token as a bearer authorization header', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'supabase-session-token' } } });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await apiClient.get('/api/test');

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer supabase-session-token');
    expect(headers.has('x-admin-token')).toBe(false);
  });

  it('does not attach a legacy admin token when no Supabase session exists', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await apiClient.get('/api/test');

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.has('x-admin-token')).toBe(false);
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

  it('does not force logout on a 403 authorization response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('forbidden', { status: 403 })
    );
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);

    await expect(apiClient.get('/api/test')).rejects.toMatchObject({ status: 403 });
    expect(listener).not.toHaveBeenCalled();

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
