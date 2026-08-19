import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: NextRequest) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const query = new URL(req.url).search;
  const res = await fetch(`${API_URL}/api/stockist/service-usage${query}`, {
    signal: AbortSignal.timeout(10_000),
    headers: createStockistProxyHeaders(auth.session),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: NextRequest) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const res = await fetch(`${API_URL}/api/stockist/service-usage/open`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { ...createStockistProxyHeaders(auth.session), 'Content-Type': 'application/json' },
    body: JSON.stringify(await req.json()),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
