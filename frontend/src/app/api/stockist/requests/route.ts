import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: NextRequest) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  const res = await fetch(`${API_URL}/api/stockist/requests${qs ? `?${qs}` : ''}`, {
    signal: AbortSignal.timeout(10_000),
    headers: createStockistProxyHeaders(auth.session),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: NextRequest) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const res = await fetch(`${API_URL}/api/stockist/requests`, {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { ...createStockistProxyHeaders(auth.session), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
