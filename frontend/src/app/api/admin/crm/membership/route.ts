import { NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN   = process.env.ADMIN_PASSWORD ?? '';
export async function GET() {
  const res = await fetch(`${API_URL}/api/admin/crm/membership`, { signal: AbortSignal.timeout(10_000),  headers: { 'x-admin-token': TOKEN } });
  return NextResponse.json(await res.json(), { status: res.status });
}
