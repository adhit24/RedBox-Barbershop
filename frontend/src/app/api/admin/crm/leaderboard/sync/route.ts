import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const res = await fetch(`${API_URL}/api/admin/crm/leaderboard/sync`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(120_000),
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': TOKEN,
    },
  });

  return NextResponse.json(await res.json(), { status: res.status });
}
