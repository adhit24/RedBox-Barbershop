import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EmployeeDetail } from '../EmployeeDetail';
import * as crmService from '../../services/crm';

vi.mock('../../services/crm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/crm')>();
  return {
    ...actual,
    getEmployeeDetail: vi.fn(),
  };
});

describe('EmployeeDetail (Real Data & Honest Unavailable)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT render DemoBadge or static Dodi fixtures', async () => {
    vi.mocked(crmService.getEmployeeDetail).mockResolvedValueOnce({
      ok: true,
      type: 'regular',
      person: {
        id: 'emp-123',
        code: 'SD-REG-001',
        name: 'Abi Bhakti',
        nickname: 'Abi',
        business_unit: 'Sundaze Cafe',
        branch: 'bypass',
        branch_name: 'Bypass',
        position: 'Barista',
        employment_type: 'regular',
        payroll_type: 'Gaji',
        is_active: true,
        join_date: '2025-08-01',
      },
    });

    render(
      <MemoryRouter initialEntries={['/hr/employees/emp-123']}>
        <Routes>
          <Route path="/hr/employees/:id" element={<EmployeeDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Abi Bhakti/i).length).toBeGreaterThan(0);
    });

    // Verify NO DemoBadge
    expect(screen.queryByText(/DEMO/i)).toBeNull();

    // Verify NO static Dodi Iskandar fixture
    expect(screen.queryByText('Dodi Iskandar')).toBeNull();

    // Verify real identity fields
    expect(screen.getByText('Barista · Sundaze Cafe')).toBeInTheDocument();
    expect(screen.getByText('SD-REG-001')).toBeInTheDocument();
    expect(screen.getByText('Gaji')).toBeInTheDocument();
    expect(screen.getByText('Bypass')).toBeInTheDocument();

    // Verify honest unavailable states for unintegrated sections
    expect(screen.getAllByText('Belum tersedia').length).toBeGreaterThan(0);
    expect(screen.getByText('Data performa belum terhubung')).toBeInTheDocument();
    expect(screen.getByText('Riwayat mutasi belum dicatat')).toBeInTheDocument();
  });

  it('renders barber personnel correctly from route id', async () => {
    vi.mocked(crmService.getEmployeeDetail).mockResolvedValueOnce({
      ok: true,
      type: 'barber',
      person: {
        id: 'barber-csb-indra',
        code: 'csb-indra',
        name: 'Indra Gunawan',
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
      <MemoryRouter initialEntries={['/hr/employees/barber-csb-indra']}>
        <Routes>
          <Route path="/hr/employees/:id" element={<EmployeeDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Indra Gunawan/i).length).toBeGreaterThan(0);
    });

    expect(screen.getByText('Kapster (Barber)')).toBeInTheDocument();
    expect(screen.getByText('Bagi Hasil')).toBeInTheDocument();
    expect(screen.getByText('CSB')).toBeInTheDocument();
  });

  it('handles not found state gracefully', async () => {
    vi.mocked(crmService.getEmployeeDetail).mockRejectedValueOnce({
      status: 404,
      message: 'Employee not found',
    });

    render(
      <MemoryRouter initialEntries={['/hr/employees/unknown-id']}>
        <Routes>
          <Route path="/hr/employees/:id" element={<EmployeeDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Karyawan tidak ditemukan')).toBeInTheDocument();
    });
  });
});
