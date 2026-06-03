import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN   = process.env.ADMIN_PASSWORD ?? '';
export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search;
  const res = await fetch(`${API_URL}/api/admin/crm/owner-revenue${qs}`,
    { headers: { 'x-admin-token': TOKEN } });
  return NextResponse.json(await res.json(), { status: res.status });
}
