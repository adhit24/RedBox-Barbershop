// frontend/src/lib/adminCrmApi.ts

import type {
  CommandCenterData, AttendanceData, CustomerRow,
  LeaderboardItem, ScheduleData, BroadcastLog,
  OwnerOverviewData, OwnerRevenueData, PaymentAnalyticsData,
} from './adminCrmTypes';

async function crmFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`CRM API error ${res.status}: ${text}`);
  }
  return res.json();
}

export function fetchCommandCenter(branch: string) {
  return crmFetch<CommandCenterData>(`/api/admin/crm/command-center?branch=${branch}`);
}

export function fetchAttendance(branch: string, date?: string) {
  const q = date ? `&date=${date}` : '';
  return crmFetch<AttendanceData>(`/api/admin/crm/attendance?branch=${branch}${q}`);
}

export function updateAttendance(barber_id: string, date: string, status: string, note?: string) {
  return crmFetch<{ ok: boolean }>('/api/admin/crm/attendance', {
    method: 'POST',
    body: JSON.stringify({ barber_id, date, status, note }),
  });
}

export function fetchAttendanceHistory(branch: string, month: string) {
  return crmFetch<{ barbers: Array<{id: string; name: string}>; records: Array<{barber_id: string; date: string; status: string}>; month: string }>(
    `/api/admin/crm/attendance/history?branch=${branch}&month=${month}`
  );
}

export function fetchLoyalCustomers(branch: string) {
  return crmFetch<{ customers: CustomerRow[] }>(`/api/admin/crm/customers/loyal?branch=${branch}`);
}

export function fetchNewCustomers(branch: string) {
  return crmFetch<{ customers: CustomerRow[] }>(`/api/admin/crm/customers/new?branch=${branch}`);
}

export function fetchDormantCustomers(branch: string) {
  return crmFetch<{ customers: CustomerRow[] }>(`/api/admin/crm/customers/dormant?branch=${branch}`);
}

export function fetchAdminLeaderboard(branch: string, category: 'customer' | 'streak' | 'home_service') {
  return crmFetch<{ items: LeaderboardItem[]; category: string }>(
    `/api/admin/crm/leaderboard?branch=${branch}&category=${category}`
  );
}

export function syncAdminLeaderboard(branch: string) {
  return crmFetch<{ ok: boolean; branch: string; scope: 'current_month'; syncedAt: string }>(
    '/api/admin/crm/leaderboard/sync',
    {
      method: 'POST',
      body: JSON.stringify({ branch }),
    },
  );
}

export function reassignBooking(booking_id: string, new_barber_id: string) {
  return crmFetch<{ ok: boolean }>('/api/admin/crm/booking?action=reassign', {
    method: 'POST',
    body: JSON.stringify({ booking_id, new_barber_id }),
  });
}

export function rescheduleBooking(booking_id: string, date: string, time: string, barber_id?: string) {
  return crmFetch<{ ok: boolean }>('/api/admin/crm/booking?action=reschedule', {
    method: 'POST',
    body: JSON.stringify({ booking_id, date, time, barber_id }),
  });
}

export function createWalkIn(data: { name?: string; wa?: string; barber_id: string; service: string; branch: string }) {
  return crmFetch<{ ok: boolean }>('/api/admin/crm/booking?action=walkin', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function fetchSchedule(branch: string, week: string) {
  return crmFetch<ScheduleData>(`/api/admin/crm/schedule?branch=${branch}&week=${week}`);
}

export function blockBarberDate(barber_id: string, date: string) {
  return crmFetch<{ ok: boolean }>('/api/admin/crm/schedule?action=block', {
    method: 'POST',
    body: JSON.stringify({ barber_id, date }),
  });
}

export function unblockBarberDate(barber_id: string, date: string) {
  return crmFetch<{ ok: boolean }>('/api/admin/crm/schedule?action=unblock', {
    method: 'POST',
    body: JSON.stringify({ barber_id, date }),
  });
}

export function sendBroadcast(branch: string, message: string, target = 'all') {
  return crmFetch<{ ok: boolean; sent: number }>('/api/admin/crm/broadcast', {
    method: 'POST',
    body: JSON.stringify({ branch, message, target }),
  });
}

export function fetchBroadcastLog(branch: string) {
  return crmFetch<{ logs: BroadcastLog[] }>(`/api/admin/crm/broadcast?branch=${branch}`);
}

export function fetchOwnerOverview(): Promise<OwnerOverviewData> {
  return crmFetch<OwnerOverviewData>('/api/admin/crm/owner-overview');
}

export function fetchOwnerRevenue(branch: string, period: string): Promise<OwnerRevenueData> {
  return crmFetch<OwnerRevenueData>(`/api/admin/crm/owner-revenue?branch=${branch}&period=${period}`);
}

export function fetchPaymentAnalytics(branch: string, period: string): Promise<PaymentAnalyticsData> {
  return crmFetch<PaymentAnalyticsData>(`/api/admin/crm/owner-payment-analytics?branch=${branch}&period=${period}`);
}

export interface BarberRecord {
  id: string;
  name: string;
  branch: string;
  is_active: boolean;
  img?: string | null;
  work_days?: string[];
  today_count?: number;
}

export function fetchAllBarbers(): Promise<{ data: BarberRecord[] }> {
  return crmFetch<{ data: BarberRecord[] }>('/api/admin/barbers?include_inactive=1');
}

export function toggleBarberActive(id: string, is_active: boolean): Promise<{ success?: boolean; ok?: boolean }> {
  return crmFetch<{ success?: boolean; ok?: boolean }>(`/api/admin/barber-toggle/${id}`, {
    method: 'POST',
    body: JSON.stringify({ is_active }),
  });
}

export function toggleBarberTodayOverride(
  id: string,
  available: boolean,
  date?: string,
): Promise<{ success?: boolean }> {
  const path = date
    ? `/api/admin/barber-override/${id}?date=${date}`
    : `/api/admin/barber-override/${id}`;
  return crmFetch<{ success?: boolean }>(path, {
    method: 'POST',
    body: JSON.stringify({ available }),
  });
}
