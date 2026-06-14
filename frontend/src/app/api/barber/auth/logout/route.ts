import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest) {
  const token = req.cookies.get('redbox_barber_session')?.value || '';
  await fetch(`${API_URL}/api/barber/auth/logout`, { signal: AbortSignal.timeout(10_000), 
    method: 'POST',
    headers: { 'x-barber-token': token },
  }).catch(() => {});
  const response = NextResponse.json({ ok: true });
  response.cookies.delete('redbox_barber_session');
  response.cookies.delete('redbox_impersonator');
  return response;
}
