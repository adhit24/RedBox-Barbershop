import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PayrollEmployeeDetail } from '../PayrollEmployeeDetail';
import * as crmService from '../../services/crm';

vi.mock('../../services/crm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/crm')>();
  return {
    ...actual,
    getEmployeeDetail: vi.fn(),
  };
});

describe('PayrollEmployeeDetail (Real Identity & Honest Unavailable States)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders real employee identity and hides unverified compensation formulas', async () => {
    vi.mocked(crmService.getEmployeeDetail).mockResolvedValueOnce({
      ok: true,
      type: 'regular',
      person: {
        id: 'emp-101',
        code: 'RB-REG-002',
        name: 'Employee Alpha',
        nickname: null,
        business_unit: 'Redbox Barbershop',
        branch: 'sumber',
        branch_name: 'Sumber',
        position: 'Cashier',
        employment_type: 'regular',
        payroll_type: 'Gaji',
        is_active: true,
        join_date: '2025-08-01',
      },
    });

    render(
      <MemoryRouter initialEntries={['/payroll/employees/emp-101']}>
        <Routes>
          <Route path="/payroll/employees/:id" element={<PayrollEmployeeDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Employee Alpha')).toBeInTheDocument();
    });

    // Verify NO DemoBadge
    expect(screen.queryByText(/DEMO/i)).toBeNull();

    // Verify NO fake Dodi Iskandar or fake pay numbers
    expect(screen.queryByText('Dodi Iskandar')).toBeNull();
    expect(screen.queryByText(/Rp\s*4\.850\.000/i)).toBeNull();
    expect(screen.queryByText('Final Pay')).toBeNull();

    // Verify real identity fields
    expect(screen.getByText('Skema: Gaji')).toBeInTheDocument();
    expect(screen.getByText('Cashier · Redbox Barbershop · Cabang Sumber')).toBeInTheDocument();

    // Verify honest unavailable states
    expect(screen.getByText('Rincian payroll periode ini belum tersedia')).toBeInTheDocument();
    expect(screen.getAllByText('Formula belum tervalidasi').length).toBeGreaterThan(0);
    expect(screen.getByText('Belum terhubung')).toBeInTheDocument();
  });

  it('renders barber identity with Bagi Hasil', async () => {
    vi.mocked(crmService.getEmployeeDetail).mockResolvedValueOnce({
      ok: true,
      type: 'barber',
      person: {
        id: 'barber-csb-indra',
        code: 'csb-indra',
        name: 'Barber Alpha',
        nickname: null,
        business_unit: 'Redbox Barbershop',
        branch: 'csb',
        branch_name: 'CSB',
        position: 'Kapster',
        employment_type: 'barber',
        payroll_type: 'Bagi Hasil',
        is_active: true,
        join_date: null,
      },
    });

    render(
      <MemoryRouter initialEntries={['/payroll/employees/barber-csb-indra']}>
        <Routes>
          <Route path="/payroll/employees/:id" element={<PayrollEmployeeDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Barber Alpha')).toBeInTheDocument();
    });

    expect(screen.getByText('Skema: Bagi Hasil')).toBeInTheDocument();
    expect(screen.getByText('Pendapatan Layanan (Bagi Hasil)')).toBeInTheDocument();
    expect(screen.getByText('← Kembali ke Barber Payroll')).toBeInTheDocument();
  });
});
