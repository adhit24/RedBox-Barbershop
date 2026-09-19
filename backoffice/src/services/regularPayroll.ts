import { apiClient } from '../lib/apiClient';

export interface RegularPayrollRunSummary {
  total_employees: number;
  total_gross_pay: number;
  total_deductions: number;
  total_take_home_pay: number;
  review_required_count: number;
  missing_salary_count: number;
}

export interface RegularPayrollRun {
  id: string;
  payroll_type: string;
  business_unit: string;
  period_start: string;
  period_end: string;
  status: 'DRAFT' | 'LOCKED';
  generated_at: string;
  generated_by: string;
  locked_at: string | null;
  locked_by: string | null;
  calculation_version: string;
  summary: RegularPayrollRunSummary;
  created_at: string;
  updated_at: string;
}

export interface AttendanceSummary {
  present_days: number;
  absent_days: number;
  late_count: number;
  late_minutes: number;
  overtime_hours: number;
  incomplete_attendance: number;
  unresolved_exceptions_count: number;
}

export interface RegularPayrollAdjustment {
  id: string;
  payroll_run_id: string;
  payroll_regular_item_id: string;
  employee_id: string;
  type: 'BONUS' | 'DEDUCTION' | 'DEBT' | 'CORRECTION' | 'OTHER';
  amount: number;
  reason: string;
  note?: string | null;
  created_by: string;
  created_at: string;
}

export interface RegularPayrollItem {
  id: string;
  payroll_run_id: string;
  employee_id: string;

  employee_name_snapshot: string;
  employee_nickname_snapshot: string | null;
  business_unit_snapshot: string;
  position_snapshot: string;
  branch_snapshot: string | null;

  base_salary: number;
  daily_salary: number;
  salary_divisor: number;
  work_days: number;
  actual_salary: number;

  meal_allowance_days: number;
  meal_allowance_rate: number;
  meal_allowance_total: number;

  position_allowance: number;
  attendance_allowance: number;
  attendance_allowance_source: string;

  product_commission: number;
  product_commission_source: string;
  service_barber_amount: number;
  service_barber_source: string;
  overtime_hours: number;
  overtime_rate: number;
  overtime_amount: number;

  late_count: number;
  late_penalty_rate: number;
  late_deduction: number;
  late_deduction_source: string;
  debt_deduction: number;
  manual_deduction: number;

  manual_bonus: number;
  adjustments_total: number;

  gross_pay: number;
  total_deduction: number;
  take_home_pay: number;

  attendance_summary: AttendanceSummary;
  warnings: string[];
  status: 'READY' | 'REVIEW_REQUIRED' | 'MISSING_SALARY' | 'MISSING_ATTENDANCE' | 'LOCKED';

  created_at: string;
  updated_at: string;

  adjustments?: RegularPayrollAdjustment[];
}

export interface RegularPayrollDetailResponse {
  run: RegularPayrollRun;
  items: RegularPayrollItem[];
}

export async function fetchRegularPayrollRuns(params?: {
  status?: string;
  business_unit?: string;
}): Promise<{ runs: RegularPayrollRun[] }> {
  const q = new URLSearchParams();
  if (params?.status && params.status !== 'all') q.set('status', params.status);
  if (params?.business_unit && params.business_unit !== 'all') q.set('business_unit', params.business_unit);
  const query = q.toString() ? `?${q.toString()}` : '';
  return apiClient.get<{ runs: RegularPayrollRun[] }>(`/api/payroll/regular-runs${query}`);
}

export async function fetchRegularPayrollRunDetail(
  runId: string,
  params?: { status?: string; business_unit?: string }
): Promise<RegularPayrollDetailResponse> {
  const q = new URLSearchParams();
  if (params?.status && params.status !== 'all') q.set('status', params.status);
  if (params?.business_unit && params.business_unit !== 'all') q.set('business_unit', params.business_unit);
  const query = q.toString() ? `?${q.toString()}` : '';
  return apiClient.get<RegularPayrollDetailResponse>(`/api/payroll/regular-runs/${runId}${query}`);
}

export async function generateRegularPayrollDraft(payload: {
  period_start: string;
  period_end: string;
  business_unit?: string;
}): Promise<{ success: boolean; run_id: string; summary: RegularPayrollRunSummary }> {
  return apiClient.post('/api/payroll/regular-runs', payload);
}

export async function lockRegularPayrollRun(runId: string): Promise<{ success: boolean; status: string }> {
  return apiClient.post(`/api/payroll/regular-runs/${runId}/lock`, {});
}

export async function addRegularPayrollAdjustment(payload: {
  runId: string;
  payroll_regular_item_id: string;
  employee_id: string;
  type: string;
  amount: number;
  reason: string;
  note?: string;
}): Promise<{ success: boolean; adjustment: RegularPayrollAdjustment }> {
  return apiClient.post(`/api/payroll/regular-runs/${payload.runId}/adjustments`, payload);
}

export async function deleteRegularPayrollAdjustment(adjustmentId: string): Promise<{ success: boolean }> {
  return apiClient.delete(`/api/payroll/regular-runs/adjustments/${adjustmentId}`);
}
