import { NextRequest, NextResponse } from 'next/server';
import { requireBookingAdminSession } from '../_auth';
import { authorizeBookingPatchOperation } from '../_policy';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const ADMIN_TOKEN = process.env.ADMIN_PASSWORD ?? '';

// Canonical Authority Guard: Secure Proxy PATCH /api/bookings/:id to Express backend
// Ensures caller is verified Backoffice admin (owner or manager), manager is branch-scoped,
// and barber overlap checks, schedules sync, and notifications run canonically.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Authenticate caller and enforce Backoffice role (owner or manager)
  const authResult = await requireBookingAdminSession(req);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { session, supabase } = authResult;
  const { id } = await params;

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 });
  }

  if (!ADMIN_TOKEN) {
    console.error('[API Route Booking ID] ADMIN_PASSWORD is not configured on server');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  // 2. Lookup existing booking to check branch scope for manager
  // Managers must remain strictly branch-scoped to their assigned branch.
  if (session.role === 'manager') {
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, location')
      .eq('id', id)
      .maybeSingle();

    if (bookingError) {
      console.error('[API Route Booking ID] DB lookup error:', bookingError.message);
      return NextResponse.json({ error: 'Gagal memverifikasi data booking' }, { status: 500 });
    }

    const opDecision = authorizeBookingPatchOperation(session, booking, body);
    if (!opDecision.ok) {
      return NextResponse.json({ error: opDecision.error }, { status: opDecision.status });
    }
  }

  // 3. Forward to Express canonical endpoint with server-side admin secret.
  // NEVER forward client-supplied x-admin-token or trust client headers.
  // Never expose ADMIN_PASSWORD to client.
  try {
    const res = await fetch(`${API_URL}/api/bookings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API Route Booking ID] Proxy PATCH error:', message);
    return NextResponse.json(
      { error: 'Gagal menghubungi server utama' },
      { status: 502 }
    );
  }
}
