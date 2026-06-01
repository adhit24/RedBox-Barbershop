import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function PUT(req: NextRequest) {
  const token = req.cookies.get('redbox_barber_session')?.value || '';
  const body = await req.json();
  const res = await fetch(`${API_URL}/api/barber/target`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-barber-token': token },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
