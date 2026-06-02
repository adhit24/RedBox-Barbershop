import type { Booking, Barber, StatsResponse, RevenueResponse } from './constants';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  // Relative paths (Next.js proxy routes) hit same origin; absolute API paths go to Express
  const url = path.startsWith('/api/admin/') ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// Backend wraps list responses as { data: [...] } — unwrap to array.
function unwrap<T>(res: { data?: T[] } | T[]): T[] {
  return Array.isArray(res) ? res : (res?.data ?? []);
}

// Normalize MySQL/Supabase field-name differences into our Booking interface.
function normalizeBooking(b: Record<string, unknown>): Booking {
  return {
    id:             String(b.id ?? ''),
    date:           String(b.date ?? b.booking_date ?? ''),
    time:           String(b.time ?? b.booking_time ?? ''),
    customer_name:  String(b.customer_name ?? b.name ?? ''),
    customer_phone: String(b.customer_phone ?? b.wa ?? ''),
    barber_id:      (b.barber_id as string | null) ?? null,
    barber_name:    (b.barber_name as string | null) ?? null,
    service:        String(b.service ?? b.service_name ?? ''),
    location:       String(b.location ?? ''),
    status:         (b.status as Booking['status']) ?? 'pending',
    price:          (b.price as number | null) ?? null,
    address:        (b.address as string | null) ?? null,
    type:           (b.type as string | null) ?? null,
  };
}

export async function fetchBookings(params: {
  date?: string;
  location?: string;
  barber_id?: string;
  status?: string;
}): Promise<Booking[]> {
  const q = new URLSearchParams();
  if (params.date)                                  q.set('date', params.date);
  if (params.location && params.location !== 'all') q.set('location', params.location);
  if (params.barber_id)                             q.set('barber_id', params.barber_id);
  if (params.status)                                q.set('status', params.status);
  const raw = await fetchJSON<{ data?: Record<string, unknown>[] } | Record<string, unknown>[]>(
    `/api/bookings?${q}`
  );
  return unwrap(raw).map(normalizeBooking);
}

export async function fetchBarbers(includeInactive = true): Promise<Barber[]> {
  const path = includeInactive ? '/api/admin/barbers?include_inactive=1' : '/api/barbers';
  const raw = await fetchJSON<{ data?: Barber[] } | Barber[]>(path);
  return unwrap(raw);
}

export function fetchStats() {
  return fetchJSON<StatsResponse>('/api/admin/stats');
}

export function fetchRevenue(period: 'week' | 'month' = 'month', branch?: string) {
  const q = new URLSearchParams({ period });
  if (branch && branch !== 'all') q.set('branch', branch);
  return fetchJSON<RevenueResponse>(`/api/admin/revenue?${q}`);
}
