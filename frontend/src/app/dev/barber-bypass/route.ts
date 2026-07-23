import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const token = req.nextUrl.searchParams.get('token');
  const target = req.nextUrl.searchParams.get('redirect') || '/barber/home';

  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  const response = NextResponse.redirect(new URL(target, req.url));
  response.cookies.set('redbox_barber_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  });
  return response;
}
