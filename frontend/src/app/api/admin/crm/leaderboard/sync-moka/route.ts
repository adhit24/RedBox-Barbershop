import { NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';

export async function POST() {
  const res = await fetch(`${API_URL}/api/admin/crm/leaderboard/sync-moka`, {
    signal: AbortSignal.timeout(60_000),
    method: 'POST',
    headers: { 'x-admin-token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
