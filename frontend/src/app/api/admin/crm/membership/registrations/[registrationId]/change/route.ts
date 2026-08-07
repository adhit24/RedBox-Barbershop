import { NextRequest, NextResponse } from 'next/server';
import {
  createMembershipAdminProxyHeaders,
  requireMembershipAdminSession,
} from '../../../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const PAID_TIERS = new Set(['silver', 'gold', 'platinum']);
const MEMBERSHIP_CHANGE_TYPES = new Set(['RENEWAL', 'UPGRADE']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ registrationId: string }> },
) {
  const auth = await requireMembershipAdminSession();
  if (!auth.ok) return auth.response;

  const { registrationId } = await params;
  const body = await request.json().catch(() => ({}));
  const tier = typeof body.tier === 'string' ? body.tier.trim().toLowerCase() : '';
  const registrationType = typeof body.registrationType === 'string'
    ? body.registrationType.trim().toUpperCase()
    : '';
  if (!registrationId || !PAID_TIERS.has(tier) || !MEMBERSHIP_CHANGE_TYPES.has(registrationType)) {
    return NextResponse.json({
      error: 'registrationId, valid destination tier, and registrationType are required',
    }, { status: 400 });
  }

  try {
    const headers = createMembershipAdminProxyHeaders(auth.session);
    const response = await fetch(`${API_URL}/api/admin/crm/membership/registrations/${encodeURIComponent(registrationId)}/change`, {
      signal: AbortSignal.timeout(10_000),
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier, registrationType }),
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not configured')) {
      return NextResponse.json({ error: 'CRM membership proxy is not configured' }, { status: 500 });
    }
    return NextResponse.json({ error: 'CRM membership renewal or upgrade service unavailable' }, { status: 502 });
  }
}
