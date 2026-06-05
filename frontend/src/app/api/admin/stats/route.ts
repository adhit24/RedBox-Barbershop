import { NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';

export async function GET() {
  const res = await fetch(`${API_URL}/api/stats`, { signal: AbortSignal.timeout(10_000), 
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
