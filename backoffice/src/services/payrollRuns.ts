import { apiClient } from '../lib/apiClient';

export interface PayrollBlocker {
  type: string;
  message: string;
  barber_id?: string;
  barber_name?: string;
  count?: number;
}

export interface PayrollRun {
  id: string;
  payroll_type: string;
  business_unit: string;
  period_start: string;
  period_end: string;
  status: 'DRAFT' | 'LOCKED';
  total_service_revenue: number;
  total_commission: number;
  total_adjustments: number;
  total_payable: number;
  barber_count: number;
  blocking_issues_count: number;
  generated_at: string;
  generated_by: string;
  locked_at: string | null;
  locked_by: string | null;
  calculation_version: string;
  created_at: string;
  updated_at: string;
}

export interface AttendanceContext {
  days_present: number;
  late_count: number;
  attendance_exceptions: number;
}

export interface PayrollBarberItem {
  id: string;
  payroll_run_id: string;
  barber_id: string;
  barber_name_snapshot: string;
  branch_snapshot: string;
  service_item_count: number;
  receipt_count: number;
  gross_service_revenue: number;
  discount_total: number;
  net_service_revenue: number;
  commission_amount: number;
  manual_adjustment_total: number;
  payable_amount: number;
  review_required_count: number;
  missing_rate_count: number;
  attendance_context: AttendanceContext;
  status: 'READY' | 'MISSING_RATE' | 'REVIEW_REQUIRED';
  commission_lines_count?: number;
  adjustments_count?: number;
}

export interface PayrollCommissionItem {
  id: string;
  payroll_run_id: string;
  payroll_barber_item_id: string;
  source_moka_transaction_item_id: string;
  receipt_number: string;
  tx_date: string;
  service_name_snapshot: string;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  commission_rate_used: number;
  commission_amount: number;
  rate_source: string;
  rate_effective_from: string | null;
  barber_id_snapshot: string;
  branch_snapshot: string;
  created_at: string;
}

export interface PayrollAdjustment {
  id: string;
  payroll_run_id: string;
  payroll_barber_item_id: string | null;
  barber_id: string;
  amount: number;
  reason: string;
  note: string | null;
  created_by: string;
  created_at: string;
}

export interface PayrollReviewItem {
  id: string;
  payroll_run_id: string;
  source_moka_transaction_item_id: string | null;
  receipt_number: string;
  tx_date: string;
  item_name_snapshot: string;
  classification_snapshot: string;
  barber_id: string | null;
  barber_name_snapshot: string | null;
  branch_snapshot: string | null;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  reason_code: string;
  blocking: boolean;
  detail: string | null;
  created_at: string;
}

export interface PayrollRunDetailResponse {
  run: PayrollRun;
  barbers: PayrollBarberItem[];
  blockers: PayrollBlocker[];
  review_items: PayrollReviewItem[];
  adjustments: PayrollAdjustment[];
}

export interface BarberRunDetailResponse {
  barber: PayrollBarberItem;
  run: PayrollRun;
  commission_lines: PayrollCommissionItem[];
  review_items: PayrollReviewItem[];
  adjustments: PayrollAdjustment[];
  attendance_context: AttendanceContext;
}

export async function listPayrollRuns(status?: string): Promise<PayrollRun[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await apiClient.get<{ runs: PayrollRun[] }>(`/api/payroll/barber-runs${query}`);
  return res.runs;
}

export async function getPayrollRunDetail(runId: string): Promise<PayrollRunDetailResponse> {
  return await apiClient.get<PayrollRunDetailResponse>(`/api/payroll/barber-runs/${runId}`);
}

export async function getBarberRunDetail(runId: string, barberId: string): Promise<BarberRunDetailResponse> {
  return await apiClient.get<BarberRunDetailResponse>(`/api/payroll/barber-runs/${runId}/barbers/${barberId}`);
}

export async function generatePayrollDraft(periodStart: string, periodEnd: string): Promise<{ run: PayrollRun; blockers: PayrollBlocker[] }> {
  return await apiClient.post<{ run: PayrollRun; blockers: PayrollBlocker[] }>('/api/payroll/barber-runs', {
    period_start: periodStart,
    period_end: periodEnd,
  });
}

export async function regeneratePayrollDraft(runId: string): Promise<{ run: PayrollRun; blockers: PayrollBlocker[] }> {
  return await apiClient.post<{ run: PayrollRun; blockers: PayrollBlocker[] }>(`/api/payroll/barber-runs/${runId}/regenerate`);
}

export async function lockPayrollRun(runId: string): Promise<{ success: boolean; run: PayrollRun; locked_at: string }> {
  return await apiClient.post<{ success: boolean; run: PayrollRun; locked_at: string }>(`/api/payroll/barber-runs/${runId}/lock`);
}

export async function addManualAdjustment(
  runId: string,
  barberId: string,
  data: { amount: number; reason: string; note?: string }
): Promise<PayrollAdjustment> {
  const res = await apiClient.post<{ adjustment: PayrollAdjustment }>(
    `/api/payroll/barber-runs/${runId}/barbers/${barberId}/adjustments`,
    data
  );
  return res.adjustment;
}

export async function deleteManualAdjustment(runId: string, adjustmentId: string): Promise<void> {
  await apiClient.delete(`/api/payroll/barber-runs/${runId}/adjustments/${adjustmentId}`);
}
