import { NextRequest, NextResponse } from 'next/server';
import {
  createMembershipAdminProxyHeaders,
  requireMembershipAdminSession,
} from '../../../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ registrationId: string }> },
) {
  const auth = await requireMembershipAdminSession();
  if (!auth.ok) return auth.response;

  const { registrationId } = await params;
  if (!registrationId) {
    return NextResponse.json({ error: 'registrationId required' }, { status: 400 });
  }

  try {
    const headers = createMembershipAdminProxyHeaders(auth.session);
    const response = await fetch(`${API_URL}/api/admin/crm/membership/registrations/${encodeURIComponent(registrationId)}/cancel`, {
      signal: AbortSignal.timeout(10_000),
      method: 'POST',
      headers,
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not configured')) {
      return NextResponse.json({ error: 'CRM membership proxy is not configured' }, { status: 500 });
    }
    return NextResponse.json({ error: 'CRM membership cancellation service unavailable' }, { status: 502 });
  }
}
