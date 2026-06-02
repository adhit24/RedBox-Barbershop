import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';

export async function GET(req: NextRequest) {
  const includeInactive = req.nextUrl.searchParams.get('include_inactive');
  const qs = includeInactive ? '?include_inactive=1' : '';
  const res = await fetch(`${API_URL}/api/barbers${qs}`, {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
