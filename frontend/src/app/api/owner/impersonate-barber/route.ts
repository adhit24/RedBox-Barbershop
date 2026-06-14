// frontend/src/app/api/owner/impersonate-barber/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/utils/supabase/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const ADMIN_TOKEN = process.env.ADMIN_PASSWORD ?? '';

export async function POST(req: NextRequest) {
  // 1. Verifikasi pemanggil adalah owner
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();
  if (profile?.role !== 'owner') {
    return NextResponse.json({ error: 'Hanya owner yang boleh impersonate' }, { status: 403 });
  }

  // 2. Ambil nama kapster dari body
  const body = await req.json().catch(() => ({}));
  const name = (body?.name || '').toString().trim();
  if (!name) {
    return NextResponse.json({ error: 'name wajib diisi' }, { status: 400 });
  }

  // 3. Panggil backend impersonate (token disuntik di server, tidak di URL klien)
  const res = await fetch(
    `${API_URL}/api/admin/crm/impersonate-barber?name=${encodeURIComponent(name)}`,
    { headers: { 'x-admin-token': ADMIN_TOKEN }, signal: AbortSignal.timeout(10_000) },
  );
  const data = await res.json();
  if (!res.ok || !data?.token) {
    return NextResponse.json(data, { status: res.status || 500 });
  }

  // 4. Set cookie sesi kapster + marker impersonator
  const response = NextResponse.json({ ok: true, barber: data.barber });
  response.cookies.set('redbox_barber_session', data.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  });
  // marker non-httpOnly agar barber layout (client) bisa membacanya untuk banner
  response.cookies.set('redbox_impersonator', 'owner', {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  });
  return response;
}
