import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../../../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const res = await fetch(`${API_URL}/api/stockist/notifications/${id}/read`, {
    method: 'PATCH', signal: AbortSignal.timeout(10_000),
    headers: createStockistProxyHeaders(auth.session),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
