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

export interface CommandCenterBarber {
  id: string;
  name: string;
  branch: string;
  attendance_status: string | null;
  today_count: number;
}

export interface CommandCenterBookingFeedItem {
  id: string;
  status: 'pending' | 'confirmed';
  time: string;
  barber_id: string | null;
  name: string;
  wa: string | null;
  service: string;
  notes: string | null;
}

export interface CommandCenterBranchData {
  today: string;
  barbers: CommandCenterBarber[];
  stats: {
    hadir: number;
    tidak_hadir: number;
    belum_check_in: number;
    booking_today: number;
    pending: number;
    home_service_active: number;
    moka_open_bills: number;
  };
  home_service: unknown[];
  booking_feed: CommandCenterBookingFeedItem[];
  moka_open_bills: unknown[];
  alerts: { type: string; message: string }[];
}

export function getCommandCenterForBranch(branch: string): Promise<CommandCenterBranchData> {
  return apiClient.get<CommandCenterBranchData>(`/api/admin/crm/command-center?branch=${encodeURIComponent(branch)}`);
}

export interface Customer360 {
  identity: {
    customer_found: boolean;
    customer_id: string | null;
    resolution: string;
    error?: string;
    reason?: string;
  };
  customer: {
    customer_id: string | null;
    name: string | null;
    wa_number: string | null;
    phone_e164: string | null;
    birthday: string | null;
    registration_status: string;
    is_registered_member: boolean;
    member_since: string | null;
    created_at: string | null;
  } | null;
  membership: {
    status: string | null;
    tier: string | null;
    activated_at: string | null;
    expires_at: string | null;
  } | null;
  loyalty: { points_balance: number | null; last_activity: string | null; status?: string } | null;
  activity: {
    first_visit: string | null;
    last_visit: string | null;
    last_visit_branch: string | null;
    last_visit_barber: string | null;
    last_visit_service: string | null;
    days_since_last_visit: number | null;
    completed_booking_count: number;
    cancelled_booking_count: number;
    pending_booking_count: number;
    completed_transaction_count: number;
    repeat_customer: boolean;
  } | null;
  spending: {
    transaction_count: number;
    total_spend_idr: number;
    average_transaction_value_idr: number | null;
  } | null;
  preferences: {
    favorite_branch: { value: string | null } | null;
    favorite_barber: { value: string | null } | null;
    favorite_service: { value: string | null } | null;
  } | null;
}

export function getCustomer360(params: { customer_id?: string; phone?: string; user_key?: string }): Promise<Customer360> {
  const query = new URLSearchParams();
  if (params.customer_id) query.set('customer_id', params.customer_id);
  else if (params.phone) query.set('phone', params.phone);
  else if (params.user_key) query.set('user_key', params.user_key);
  return apiClient.get<Customer360>(`/api/admin/crm/customer360?${query.toString()}`);
}

export interface CustomerSegmentsKpis {
  active_customers: number;
  new_customers: number;
  repeat_customers: number;
  loyal_customers: number;
  dormant_customers: number;
  avg_visit_interval_days: number | null;
}

export interface CustomerSegmentBucket {
  key: 'loyal' | 'repeat' | 'new' | 'dormant';
  label: string;
  count: number;
}

export interface CustomerSegmentTrendPoint {
  month: string;
  new: number;
  repeat: number;
}

export interface CustomerSegmentBranchCount {
  branch: string;
  count: number;
  total_customers: number;
  repeat_customers: number;
}

export interface CustomerSegmentFavoriteBarber {
  name: string;
  count: number;
}

export interface CustomerSegmentFavoriteService {
  service_name: string;
  count: number;
}

export interface CustomerSegmentListItem {
  customer_key: string;
  name: string;
  first_visit: string;
  last_visit: string;
  total_visits: number;
  favorite_branch: string | null;
  favorite_barber: string | null;
  visit_count_tier: 'new' | 'repeat' | 'loyal';
  engagement_status: 'active' | 'dormant';
}

export interface CustomerSegmentsResult {
  data_coverage: { from: string | null; to: string | null; classification_basis: string };
  kpis: CustomerSegmentsKpis;
  segments: CustomerSegmentBucket[];
  new_vs_repeat_trend: CustomerSegmentTrendPoint[];
  by_branch: CustomerSegmentBranchCount[];
  favorite_barbers: CustomerSegmentFavoriteBarber[];
  favorite_services: CustomerSegmentFavoriteService[];
  customers: { items: CustomerSegmentListItem[]; total: number; limit: number; offset: number };
}

export function getCustomerSegments(params: { branch?: string; limit?: number; offset?: number; search?: string }): Promise<CustomerSegmentsResult> {
  const query = new URLSearchParams({ branch: params.branch ?? 'all' });
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  if (params.search) query.set('search', params.search);
  return apiClient.get<CustomerSegmentsResult>(`/api/admin/crm/customer-segments?${query.toString()}`);
}

export interface BarberPerformanceEntry {
  barber_id: string;
  name: string;
  branch: string | null;
  customers_served: number;
  completed_services: number;
  repeat_rate: number;
}

export interface BarberPerformanceResult {
  barbers: BarberPerformanceEntry[];
}

export function getBarberPerformance(params: { branch?: string }): Promise<BarberPerformanceResult> {
  const query = new URLSearchParams({ branch: params.branch ?? 'all' });
  return apiClient.get<BarberPerformanceResult>(`/api/admin/crm/barber-performance?${query.toString()}`);
}
