import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import {
  authorizeBookingAdminSession,
  type BookingAdminSession,
} from './_policy';

export type BookingSessionResult =
  | { ok: true; session: BookingAdminSession; supabase: ReturnType<typeof createClient> }
  | { ok: false; response: NextResponse };

export async function requireBookingAdminSession(
  req?: NextRequest,
  injectedSupabase?: ReturnType<typeof createClient>
): Promise<BookingSessionResult> {
  let supabase = injectedSupabase;
  if (!supabase) {
    const cookieStore = await cookies();
    supabase = createClient(cookieStore);
  }

  // 1. Verify caller session with Supabase Auth
  let user = null;
  const authHeader = req?.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data?.user) {
        user = data.user;
      }
    }
  }

  // Fallback to cookie session if no Bearer token or if Bearer token failed
  if (!user) {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data?.user) {
      user = data.user;
    }
  }

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized: valid Supabase session required' }, { status: 401 }),
    };
  }

  // 2. Fetch caller profile from `users` table
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id,role,branch')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unable to verify admin profile' }, { status: 500 }),
    };
  }

  // 3. Authorize session via policy
  const decision = authorizeBookingAdminSession(user, profile);
  if (!decision.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: decision.error }, { status: decision.status }),
    };
  }

  return { ok: true, session: decision.value, supabase };
}
