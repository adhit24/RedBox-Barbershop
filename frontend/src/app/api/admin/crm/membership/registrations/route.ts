import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';

export async function GET(request: NextRequest) {
  const requestedStatus = request.nextUrl.searchParams.get('status')?.toLowerCase();
  const status = requestedStatus && ['all', 'pending', 'active', 'expired'].includes(requestedStatus)
    ? requestedStatus
    : 'all';
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  try {
    const response = await fetch(`${API_URL}/api/admin/crm/membership/registrations${query}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
      headers: { 'x-admin-token': TOKEN },
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: 'CRM membership service unavailable' }, { status: 502 });
  }
}
