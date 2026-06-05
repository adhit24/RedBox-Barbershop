import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'reassign';
  const body = await req.json();
  const res = await fetch(`${API_URL}/api/admin/crm/booking/${action}`, { signal: AbortSignal.timeout(10_000), 
    method: 'POST',
    headers: { 'x-admin-token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
