import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ registrationId: string }> },
) {
  const { registrationId } = await params;
  const body = await request.json().catch(() => ({}));
  const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod.trim() : '';
  const paymentReference = typeof body.paymentReference === 'string' ? body.paymentReference.trim() : '';
  const branch = typeof body.branch === 'string' ? body.branch.trim() : '';

  if (!registrationId || !paymentMethod || !paymentReference || !branch) {
    return NextResponse.json({ error: 'payment method, payment reference, and branch are required' }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_URL}/api/admin/crm/membership/registrations/${encodeURIComponent(registrationId)}/activate`, {
      signal: AbortSignal.timeout(10_000),
      method: 'POST',
      headers: { 'x-admin-token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethod, paymentReference, branch }),
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: 'CRM membership activation service unavailable' }, { status: 502 });
  }
}
