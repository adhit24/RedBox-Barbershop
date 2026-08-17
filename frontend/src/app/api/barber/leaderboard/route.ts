import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
export async function GET(req: NextRequest) {
  const token = req.cookies.get('redbox_barber_session')?.value || '';
  const res = await fetch(`${API_URL}/api/barber/leaderboard`, { cache: 'no-store', signal: AbortSignal.timeout(10_000), headers: { 'x-barber-token': token } });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('redbox_barber_session')?.value || '';
  const res = await fetch(`${API_URL}/api/barber/leaderboard/refresh`, {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(120_000),
    headers: { 'x-barber-token': token },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
