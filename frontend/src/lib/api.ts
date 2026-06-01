import type { Booking, Barber, StatsResponse, RevenueResponse } from './constants';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export function fetchBookings(params: {
  date?: string;
  location?: string;
  barber_id?: string;
  status?: string;
}) {
  const q = new URLSearchParams();
  if (params.date)                           q.set('date', params.date);
  if (params.location && params.location !== 'all') q.set('location', params.location);
  if (params.barber_id)                      q.set('barber_id', params.barber_id);
  if (params.status)                         q.set('status', params.status);
  return fetchJSON<Booking[]>(`/api/bookings?${q}`);
}

export function fetchBarbers(includeInactive = true) {
  return fetchJSON<Barber[]>(`/api/barbers${includeInactive ? '?include_inactive=1' : ''}`);
}

export function fetchStats() {
  return fetchJSON<StatsResponse>('/api/stats');
}

export function fetchRevenue(period: 'week' | 'month' = 'month', branch?: string) {
  const q = new URLSearchParams({ period });
  if (branch && branch !== 'all') q.set('branch', branch);
  return fetchJSON<RevenueResponse>(`/api/revenue?${q}`);
}
