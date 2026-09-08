import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN   = process.env.ADMIN_PASSWORD ?? '';

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search;
  const res = await fetch(`${API_URL}/api/bookings${qs}`, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'x-admin-token': TOKEN },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

// Canonical Authority Guard: POST must not directly mutate Supabase bookings.
// Instead, forward cleanly to the authoritative Express backend.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Forward safe correlation and identity headers only
    const reqId = req.headers.get('x-request-id');
    if (reqId) headers['x-request-id'] = reqId;
    const auth = req.headers.get('authorization');
    if (auth) headers['authorization'] = auth;

    const res = await fetch(`${API_URL}/api/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API Route Bookings] Proxy error:', message);
    return NextResponse.json(
      { error: message || 'Gagal menghubungi server booking utama' },
      { status: 502 }
    );
  }
}
