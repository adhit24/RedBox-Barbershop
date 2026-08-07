import { NextRequest, NextResponse } from 'next/server';
import {
  createMembershipAdminProxyHeaders,
  requireMembershipAdminSession,
} from '../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(request: NextRequest) {
  const auth = await requireMembershipAdminSession();
  if (!auth.ok) return auth.response;

  const requestedStatus = request.nextUrl.searchParams.get('status')?.toLowerCase();
  const status = requestedStatus && ['all', 'pending', 'active', 'expired'].includes(requestedStatus)
    ? requestedStatus
    : 'all';
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  try {
    const headers = createMembershipAdminProxyHeaders(auth.session);
    const response = await fetch(`${API_URL}/api/admin/crm/membership/registrations${query}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
      headers,
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not configured')) {
      return NextResponse.json({ error: 'CRM membership proxy is not configured' }, { status: 500 });
    }
    return NextResponse.json({ error: 'CRM membership service unavailable' }, { status: 502 });
  }
}
