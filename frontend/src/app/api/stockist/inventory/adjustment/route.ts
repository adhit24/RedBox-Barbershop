import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const res = await fetch(`${API_URL}/api/stockist/inventory/adjustment`, {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { ...createStockistProxyHeaders(auth.session), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
