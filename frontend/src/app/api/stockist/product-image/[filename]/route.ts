import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const ALLOWED_FILES = new Set([
  'clay.jpeg',
  'oil_base.jpeg',
  'water_base.jpeg',
  'psyi.jpeg',
  'E_left_here.jpeg',
]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  if (!ALLOWED_FILES.has(filename)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const image = await fetch(`${API_URL}/uploads/${encodeURIComponent(filename)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!image.ok) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(await image.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': image.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
