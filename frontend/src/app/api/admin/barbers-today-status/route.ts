import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') ?? '';
  const params = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await fetch(`${API_URL}/api/barbers/today-status${params}`, { signal: AbortSignal.timeout(10_000), 
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
