import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN   = process.env.ADMIN_PASSWORD ?? '';

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search;
  const res = await fetch(`${API_URL}/api/bookings${qs}`, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'x-admin-token': TOKEN },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      name,
      wa,
      service_id,
      service,
      price,
      duration,
      barber_id,
      date,
      time,
      location,
      payment,
      notes,
    } = body;

    if (!name || !wa || !service || !date || !time || !location) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('bookings')
      .insert([
        {
          name,
          wa,
          service_id: service_id || null,
          service,
          price: price ? parseInt(price) : null,
          duration: duration || null,
          barber_id: barber_id || null,
          date,
          time,
          location,
          status: 'pending',
          payment: payment || 'Cash',
          notes: notes || '',
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Supabase error inserting booking:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, booking: data }, { status: 201 });
  } catch (err: any) {
    console.error('API Route POST Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
