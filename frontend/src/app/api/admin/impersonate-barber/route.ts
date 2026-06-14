import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

// GET /api/admin/impersonate-barber?name=onoy&pw=ADMIN_PASSWORD
// Sets redbox_barber_session cookie and redirects to /barber/home
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name') || '';
  const pw   = req.nextUrl.searchParams.get('pw')   || '';

  if (!name || !pw) {
    return NextResponse.json({ error: 'name and pw are required' }, { status: 400 });
  }

  const res = await fetch(
    `${API_URL}/api/admin/crm/impersonate-barber?name=${encodeURIComponent(name)}`,
    {
      headers: {
        'x-admin-token': pw,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  const response = NextResponse.redirect(new URL('/barber/home', req.url));
  response.cookies.set('redbox_barber_session', data.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  });
  return response;
}
