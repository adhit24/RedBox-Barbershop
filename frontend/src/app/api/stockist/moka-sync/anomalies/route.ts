import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(request: NextRequest) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const search = request.nextUrl.search;
  const res = await fetch(`${API_URL}/api/stockist/moka-sync/anomalies${search}`, {
    signal: AbortSignal.timeout(10_000),
    headers: createStockistProxyHeaders(auth.session),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
