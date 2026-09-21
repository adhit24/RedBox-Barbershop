import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RegularPayroll } from '../RegularPayroll';
import * as regularPayrollService from '../../services/regularPayroll';

vi.mock('../../services/regularPayroll', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/regularPayroll')>();
  return {
    ...actual,
    fetchRegularPayrollRuns: vi.fn(),
    fetchRegularPayrollRunDetail: vi.fn(),
    generateRegularPayrollDraft: vi.fn(),
    lockRegularPayrollRun: vi.fn(),
    addRegularPayrollAdjustment: vi.fn(),
    deleteRegularPayrollAdjustment: vi.fn(),
    fetchOvertimeApprovals: vi.fn(),
    reviewOvertimeApproval: vi.fn(),
    syncOvertimeCandidates: vi.fn(),
  };
});

describe('RegularPayroll (Operational Payroll Page)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders operational payroll run, employees, take-home pay, and allows viewing details', async () => {
    const mockRun = {
      id: 'run-1',
      payroll_type: 'REGULAR',
      business_unit: 'ALL',
      period_start: '2026-08-26',
      period_end: '2026-09-25',
      status: 'DRAFT' as const,
      generated_at: new Date().toISOString(),
      generated_by: 'owner@redbox.id',
      locked_at: null,
      locked_by: null,
      calculation_version: 'regular-v1.0',
      summary: {
        total_employees: 2,
        total_gross_pay: 4728000,
        total_deductions: 0,
        total_take_home_pay: 4728000,
        review_required_count: 0,
        missing_salary_count: 0,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const mockItems = [
      {
        id: 'item-1',
        payroll_run_id: 'run-1',
        employee_id: 'emp-1',
        employee_name_snapshot: 'Employee Alpha',
        employee_nickname_snapshot: 'Alpha',
        business_unit_snapshot: 'Sundaze',
        position_snapshot: 'Barista',
        branch_snapshot: 'bypass',
        base_salary: 1800000,
        daily_salary: 60000,
        salary_divisor: 30,
        work_days: 27,
        actual_salary: 1620000,
        meal_allowance_days: 25,
        meal_allowance_rate: 20000,
        meal_allowance_total: 500000,
        position_allowance: 500000,
        attendance_allowance: 200000,
        attendance_allowance_source: 'POLICY_PENDING',
        product_commission: 0,
        product_commission_source: 'MANUAL',
        service_barber_amount: 0,
        service_barber_source: 'MANUAL',
        overtime_hours: 0,
        overtime_rate: 7500,
        overtime_amount: 0,
        late_count: 0,
        late_penalty_rate: 15000,
        late_deduction: 0,
        late_deduction_source: 'ATTENDANCE + POLICY',
        debt_deduction: 0,
        manual_deduction: 0,
        manual_bonus: 0,
        adjustments_total: 0,
        gross_pay: 2820000,
        total_deduction: 0,
        take_home_pay: 2820000,
        attendance_summary: {
          present_days: 27,
          absent_days: 3,
          late_count: 0,
          late_minutes: 0,
          overtime_hours: 0,
          incomplete_attendance: 0,
          unresolved_exceptions_count: 0,
        },
        warnings: [],
        status: 'READY' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        adjustments: [],
      },
      {
        id: 'item-2',
        payroll_run_id: 'run-1',
        employee_id: 'emp-2',
        employee_name_snapshot: 'Employee Beta',
        employee_nickname_snapshot: 'Beta',
        business_unit_snapshot: 'Redbox',
        position_snapshot: 'Cashier',
        branch_snapshot: 'bypass',
        base_salary: 1100000,
        daily_salary: 36667,
        salary_divisor: 30,
        work_days: 30,
        actual_salary: 1100000,
        meal_allowance_days: 26,
        meal_allowance_rate: 25000,
        meal_allowance_total: 650000,
        position_allowance: 0,
        attendance_allowance: 200000,
        attendance_allowance_source: 'POLICY_PENDING',
        product_commission: 98000,
        product_commission_source: 'MANUAL',
        service_barber_amount: 0,
        service_barber_source: 'MANUAL',
        overtime_hours: 24,
        overtime_rate: 7500,
        overtime_amount: 180000,
        late_count: 0,
        late_penalty_rate: 15000,
        late_deduction: 0,
        late_deduction_source: 'ATTENDANCE + POLICY',
        debt_deduction: 0,
        manual_deduction: 0,
        manual_bonus: 0,
        adjustments_total: 0,
        gross_pay: 2228000,
        total_deduction: 0,
        take_home_pay: 2228000,
        attendance_summary: {
          present_days: 30,
          absent_days: 0,
          late_count: 0,
          late_minutes: 0,
          overtime_hours: 24,
          incomplete_attendance: 0,
          unresolved_exceptions_count: 0,
        },
        warnings: [],
        status: 'READY' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        adjustments: [],
      },
    ];

    vi.mocked(regularPayrollService.fetchRegularPayrollRuns).mockResolvedValueOnce({
      runs: [mockRun],
    });
    vi.mocked(regularPayrollService.fetchRegularPayrollRunDetail).mockResolvedValueOnce({
      run: mockRun,
      items: mockItems,
    });

    render(<RegularPayroll />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Employee Alpha')).toBeInTheDocument();
      expect(screen.getByText('Employee Beta')).toBeInTheDocument();
    });

    // Verify Business units, positions, and take-home pay
    expect(screen.getByText('Barista')).toBeInTheDocument();
    expect(screen.getByText('Cashier')).toBeInTheDocument();
    expect(screen.getAllByText('READY').length).toBeGreaterThan(0);

    // Open detail drawer for Employee Alpha
    const detailButtons = screen.getAllByRole('button', { name: 'Detail' });
    fireEvent.click(detailButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('1. Gaji Pokok & Hari Kerja')).toBeInTheDocument();
      expect(screen.getByText('2. Tunjangan (Allowances)')).toBeInTheDocument();
      expect(screen.getByText('Take-Home Pay (Diterima):')).toBeInTheDocument();
    });
  });

  describe('overtime review modal', () => {
    const run = {
      id: 'run-ot',
      payroll_type: 'REGULAR',
      business_unit: 'ALL',
      period_start: '2026-08-26',
      period_end: '2026-09-25',
      status: 'DRAFT' as const,
      generated_at: new Date().toISOString(),
      generated_by: 'owner@redbox.id',
      locked_at: null,
      locked_by: null,
      calculation_version: 'regular-v1.0',
      summary: {
        total_employees: 0, total_gross_pay: 0, total_deductions: 0, total_take_home_pay: 0,
        review_required_count: 0, missing_salary_count: 0,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const approval = (over: Record<string, unknown>) => ({
      id: 'ot-1',
      employee_id: 'emp-1',
      attendance_date: '2026-09-02',
      raw_overtime_minutes: 120,
      approved_overtime_minutes: 0,
      status: 'PENDING',
      note: null,
      approved_by: null,
      approved_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      employees: { id: 'emp-1', name: 'Employee Alpha', nickname: 'Alpha', business_unit: 'Sundaze', branch: 'bypass', position: 'Barista' },
      ...over,
    });

    async function openModal(approvals: unknown[]) {
      vi.mocked(regularPayrollService.fetchRegularPayrollRuns).mockResolvedValueOnce({ runs: [run] });
      vi.mocked(regularPayrollService.fetchRegularPayrollRunDetail).mockResolvedValueOnce({ run, items: [] });
      vi.mocked(regularPayrollService.fetchOvertimeApprovals).mockResolvedValue({ approvals } as never);
      render(<RegularPayroll />, { wrapper: MemoryRouter });
      const open = await screen.findByRole('button', { name: /Tinjau Lembur/ });
      fireEvent.click(open);
    }

    it('defaults the approved field to the RAW detected minutes for a PENDING candidate (raw=120, approved=0)', async () => {
      await openModal([approval({})]);
      const input = (await screen.findByLabelText('Approved overtime minutes ot-1')) as HTMLInputElement;
      expect(input.value).toBe('120');
      expect(screen.getByText('Raw Detected Overtime')).toBeInTheDocument();
      expect(screen.getByText('Approved Overtime (min)')).toBeInTheDocument();
    });

    it('approving without touching the field sends the raw minutes, not zero', async () => {
      vi.mocked(regularPayrollService.reviewOvertimeApproval).mockResolvedValue({ success: true, approval: approval({}) } as never);
      await openModal([approval({})]);
      await screen.findByLabelText('Approved overtime minutes ot-1');
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      await waitFor(() => {
        expect(regularPayrollService.reviewOvertimeApproval).toHaveBeenCalledWith(
          'ot-1',
          expect.objectContaining({ status: 'APPROVED', approved_minutes: 120 })
        );
      });
    });

    it('refuses to send negative / non-numeric approved minutes (Approve bypasses native validation)', async () => {
      await openModal([approval({})]);
      const input = (await screen.findByLabelText('Approved overtime minutes ot-1')) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '-60' } });
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      await waitFor(() => {
        expect(screen.getByText(/angka 0 atau lebih/)).toBeInTheDocument();
      });
      expect(regularPayrollService.reviewOvertimeApproval).not.toHaveBeenCalled();
    });

    it('does not announce a successful sync when the backend reports failure', async () => {
      vi.mocked(regularPayrollService.syncOvertimeCandidates).mockResolvedValue({
        success: false, partial_success: true, candidates_found: 3, newly_created: 1, insert_errors: [{ error: 'boom' }],
      } as never);
      await openModal([approval({})]);
      fireEvent.click(await screen.findByRole('button', { name: /Tarik Kandidat dari Presensi/ }));
      await waitFor(() => {
        expect(screen.getByText(/tidak sepenuhnya berhasil/)).toBeInTheDocument();
      });
      expect(screen.queryByText(/berhasil disinkronkan/)).not.toBeInTheDocument();
    });

    it('announces success only when the sync really succeeded', async () => {
      vi.mocked(regularPayrollService.syncOvertimeCandidates).mockResolvedValue({ success: true, candidates_found: 1, newly_created: 1 } as never);
      await openModal([approval({})]);
      fireEvent.click(await screen.findByRole('button', { name: /Tarik Kandidat dari Presensi/ }));
      await waitFor(() => {
        expect(screen.getByText(/berhasil disinkronkan/)).toBeInTheDocument();
      });
    });

    it('a recorded approved value wins over the raw default (approved=90, raw=120)', async () => {
      await openModal([approval({ approved_overtime_minutes: 90 })]);
      const input = (await screen.findByLabelText('Approved overtime minutes ot-1')) as HTMLInputElement;
      expect(input.value).toBe('90');
    });
  });
});
