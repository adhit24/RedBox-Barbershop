import { apiClient } from '../lib/apiClient';

export interface RevenueSharingBarberSummary {
  barber_id: string;
  barber_name: string;
  outlet_id: string | null;
  outlet_slug: string;
  outlet_name: string;
  date_from?: string;
  date_to?: string;
  service_transaction_count: number;
  service_item_count: number;
  customer_count_if_reliably_available: number;
  gross_service_revenue: number;
  discount_total: number;
  net_service_revenue: number;
  commission_rate: number | null;
  rate_source: string;
  effective_from: string | null;
  calculated_commission: number | null;
  review_required_count: number;
  missing_rate_count: number;
  status: 'READY' | 'MISSING_RATE' | 'REVIEW_REQUIRED' | 'PARTIAL';
}

export interface RevenueSharingSummaryMetrics {
  total_net_service_revenue: number;
  total_estimated_commission: number;
  kapster_ready_count: number;
  need_review_count: number;
  missing_rate_count: number;
  unassigned_service_items_count: number;
  unassigned_review_items_count: number;
}

export interface RevenueSharingDataCoverage {
  requested_start: string | null;
  requested_end: string | null;
  available_start: string | null;
  available_end: string | null;
  period_fully_covered: boolean;
  coverage_status: 'PARTIAL' | 'UNKNOWN' | 'COMPLETE';
  coverage_basis: string;
  continuity_proven: boolean;
  missing_before: boolean;
  missing_after: boolean;
}

export interface RevenueSharingPreviewResponse {
  summary: RevenueSharingSummaryMetrics;
  barbers: RevenueSharingBarberSummary[];
  data_coverage?: RevenueSharingDataCoverage;
  unassigned: {
    service_items_count: number;
    service_net_amount?: number;
    review_items_count: number;
    sample_unassigned: Array<{
      receipt_number: string;
      item_name: string;
      net_amount: number;
      tx_date: string;
    }>;
  };
}

export interface BarberServiceItem {
  id: string;
  receipt_number: string;
  tx_date: string;
  tx_time: string | null;
  item_name: string;
  variant_name: string | null;
  quantity: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  rate_used: number | null;
  rate_source: string;
  effective_from: string | null;
  calculated_commission: number | null;
  status: 'READY' | 'MISSING_RATE' | 'REVIEW_REQUIRED';
}

export interface BarberExcludedItem {
  id: string;
  receipt_number: string;
  tx_date: string;
  item_name: string;
  variant_name: string | null;
  classification: string;
  reason: string;
  net_amount: number;
}

export interface BarberReviewItem {
  id: string;
  receipt_number: string;
  tx_date: string;
  item_name: string;
  classification: string;
  classification_reason: string;
  net_amount: number;
}

export interface BarberCommissionRate {
  id: string;
  barber_id: string;
  rate: number;
  effective_from: string;
  effective_to: string | null;
  created_by: string | null;
  created_at: string;
}

export interface BarberRevenueDetailResponse {
  barber: {
    id: string;
    name: string;
    branch: string;
    commission_rate: number | null;
    rate_source: string;
    effective_from: string | null;
  };
  summary: {
    service_item_count: number;
    excluded_item_count: number;
    review_item_count: number;
    gross_service_revenue: number;
    discount_total: number;
    net_service_revenue: number;
    estimated_commission: number | null;
    missing_rate_count: number;
    status: 'READY' | 'MISSING_RATE' | 'REVIEW_REQUIRED' | 'PARTIAL';
  };
  service_items: BarberServiceItem[];
  excluded_items: BarberExcludedItem[];
  review_items: BarberReviewItem[];
  rate_history: BarberCommissionRate[];
}

export async function getRevenueSharingPreview(params: {
  date_from?: string;
  date_to?: string;
  branch?: string;
  barber_id?: string;
  status?: string;
} = {}): Promise<RevenueSharingPreviewResponse> {
  const query = new URLSearchParams();
  if (params.date_from) query.set('date_from', params.date_from);
  if (params.date_to) query.set('date_to', params.date_to);
  if (params.branch && params.branch !== 'all') query.set('branch', params.branch);
  if (params.barber_id && params.barber_id !== 'all') query.set('barber_id', params.barber_id);
  if (params.status && params.status !== 'all') query.set('status', params.status);

  const qs = query.toString();
  return apiClient.get<RevenueSharingPreviewResponse>(
    `/api/payroll/revenue-sharing/preview${qs ? `?${qs}` : ''}`
  );
}

export async function getBarberRevenueDetail(
  barberId: string,
  params: { date_from?: string; date_to?: string } = {}
): Promise<BarberRevenueDetailResponse> {
  const query = new URLSearchParams();
  if (params.date_from) query.set('date_from', params.date_from);
  if (params.date_to) query.set('date_to', params.date_to);

  const qs = query.toString();
  return apiClient.get<BarberRevenueDetailResponse>(
    `/api/payroll/revenue-sharing/barbers/${encodeURIComponent(barberId)}/detail${qs ? `?${qs}` : ''}`
  );
}

export async function getBarberCommissionRates(barberId?: string): Promise<{ rates: BarberCommissionRate[] }> {
  const qs = barberId ? `?barber_id=${encodeURIComponent(barberId)}` : '';
  return apiClient.get<{ rates: BarberCommissionRate[] }>(`/api/payroll/revenue-sharing/rates${qs}`);
}

export async function updateBarberCommissionRate(params: {
  barberId: string;
  rate: number;
  effectiveFrom: string;
}): Promise<{ ok: boolean; rate: BarberCommissionRate }> {
  return apiClient.post<{ ok: boolean; rate: BarberCommissionRate }>(
    '/api/payroll/revenue-sharing/rates',
    params
  );
}
