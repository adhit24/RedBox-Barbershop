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
});
