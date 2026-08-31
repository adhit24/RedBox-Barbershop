import { apiClient } from '../lib/apiClient';

export type RevenuePeriod = 'today' | '7d' | '30d' | 'month';

export interface OwnerOverviewBranch {
  slug: string;
  name: string;
  revenue_moka: number;
  tx_moka: number;
  revenue_web: number;
  tx_web: number;
  hadir: number;
  total_barbers: number;
  goshow: number;
  pending_bookings: number;
}

export interface OwnerOverview {
  today: string;
  branches: OwnerOverviewBranch[];
  totals: {
    revenue_moka: number;
    revenue_web: number;
    tx_total: number;
    hadir: number;
    goshow: number;
    pending: number;
  };
}

export interface OwnerRevenueSummary {
  revenue_moka: number;
  revenue_web: number;
  tx_total: number;
  avg_tx: number;
}

export interface OwnerRevenueDailyPoint {
  date: string;
  moka: number;
  web: number;
}

export interface OwnerRevenueBranchCompare {
  slug: string;
  name: string;
  revenue_moka: number;
  revenue_web: number;
  tx_total: number;
}

export interface OwnerRevenueTopBarber {
  barber_id: string;
  name: string;
  branch: string;
  tx_count: number;
  revenue: number;
}

export interface OwnerRevenueTopService {
  service_name: string;
  count: number;
  revenue: number;
}

export interface OwnerRevenue {
  summary: OwnerRevenueSummary;
  daily_trend: OwnerRevenueDailyPoint[];
  branch_compare: OwnerRevenueBranchCompare[];
  top_barbers: OwnerRevenueTopBarber[];
  top_services: OwnerRevenueTopService[];
}

export interface MemberProfile {
  user_key: string;
  full_name: string;
  email: string;
  membership_status: 'ACTIVE' | 'INACTIVE';
  membership_activated_at: string | null;
  membership_started_at: string | null;
  membership_expires_at: string | null;
  current_tier: string;
  total_points: number;
  total_visits: number;
  created_at: string;
  phone: string | null;
  last_visit: string | null;
}

export function getOwnerOverview(): Promise<OwnerOverview> {
  return apiClient.get<OwnerOverview>('/api/admin/crm/owner-overview');
}

export function getOwnerRevenue(params: { branch?: string; period?: RevenuePeriod }): Promise<OwnerRevenue> {
  const branch = params.branch ?? 'all';
  const period = params.period ?? 'month';
  const query = new URLSearchParams({ branch, period }).toString();
  return apiClient.get<OwnerRevenue>(`/api/admin/crm/owner-revenue?${query}`);
}

export function getMembership(): Promise<MemberProfile[]> {
  return apiClient.get<MemberProfile[]>('/api/admin/crm/membership');
}
