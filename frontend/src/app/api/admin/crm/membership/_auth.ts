import { createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import {
  authorizeMembershipAdmin,
  type MembershipAdminSession,
} from './_policy';

type SessionResult =
  | { ok: true; session: MembershipAdminSession }
  | { ok: false; response: NextResponse };

export async function requireMembershipAdminSession(): Promise<SessionResult> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id,role,branch')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unable to verify admin access' }, { status: 500 }),
    };
  }

  const decision = authorizeMembershipAdmin(user, profile);
  if (!decision.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: decision.error }, { status: decision.status }),
    };
  }

  return { ok: true, session: decision.value };
}

export function createMembershipAdminProxyHeaders(session: MembershipAdminSession): Record<string, string> {
  const token = process.env.ADMIN_PASSWORD ?? '';
  const signingSecret = process.env.ADMIN_SESSION_PROXY_SECRET || token;
  if (!token || !signingSecret) throw new Error('membership admin proxy is not configured');

  const payload = Buffer.from(JSON.stringify({
    sub: session.userId,
    role: session.role,
    branch: session.branch,
    iat: Math.floor(Date.now() / 1000),
  })).toString('base64url');
  const signature = createHmac('sha256', signingSecret).update(payload).digest('base64url');

  return {
    'x-admin-token': token,
    'x-redbox-admin-session': `${payload}.${signature}`,
  };
}
