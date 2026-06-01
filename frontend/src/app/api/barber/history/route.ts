import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('redbox_barber_session')?.value || '';
  const qs = req.nextUrl.search;
  const res = await fetch(`${API_URL}/api/barber/history${qs}`, {
    headers: { 'x-barber-token': token },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
