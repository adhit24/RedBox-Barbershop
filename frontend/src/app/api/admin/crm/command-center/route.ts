import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  const res = await fetch(`${API_URL}/api/admin/crm/command-center${qs ? '?' + qs : ''}`,
    { signal: AbortSignal.timeout(10_000),  headers: { 'x-admin-token': TOKEN } });
  return NextResponse.json(await res.json(), { status: res.status });
}
