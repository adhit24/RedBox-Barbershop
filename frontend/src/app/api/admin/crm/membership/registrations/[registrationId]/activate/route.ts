import { NextRequest, NextResponse } from 'next/server';
import {
  createMembershipAdminProxyHeaders,
  requireMembershipAdminSession,
} from '../../../_auth';
import { resolveMembershipActivationBranch } from '../../../_policy';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ registrationId: string }> },
) {
  const auth = await requireMembershipAdminSession();
  if (!auth.ok) return auth.response;

  const { registrationId } = await params;
  const body = await request.json().catch(() => ({}));
  const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod.trim() : '';
  const paymentReference = typeof body.paymentReference === 'string' ? body.paymentReference.trim() : '';
  const branchDecision = resolveMembershipActivationBranch(auth.session, body.branch);

  if (!registrationId || !paymentMethod || !paymentReference) {
    return NextResponse.json({ error: 'payment method, payment reference, and branch are required' }, { status: 400 });
  }
  if (!branchDecision.ok) {
    return NextResponse.json({ error: branchDecision.error }, { status: branchDecision.status });
  }

  try {
    const headers = createMembershipAdminProxyHeaders(auth.session);
    const response = await fetch(`${API_URL}/api/admin/crm/membership/registrations/${encodeURIComponent(registrationId)}/activate`, {
      signal: AbortSignal.timeout(10_000),
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethod, paymentReference, branch: branchDecision.value }),
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not configured')) {
      return NextResponse.json({ error: 'CRM membership proxy is not configured' }, { status: 500 });
    }
    return NextResponse.json({ error: 'CRM membership activation service unavailable' }, { status: 502 });
  }
}
