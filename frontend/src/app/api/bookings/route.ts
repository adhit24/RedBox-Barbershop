import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search;
  const res = await fetch(`${API_URL}/api/bookings${qs}`);
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
