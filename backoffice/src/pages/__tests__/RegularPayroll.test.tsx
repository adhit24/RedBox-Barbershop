import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RegularPayroll } from '../RegularPayroll';
import * as crmService from '../../services/crm';

vi.mock('../../services/crm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/crm')>();
  return {
    ...actual,
    getEmployees: vi.fn(),
  };
});

describe('RegularPayroll (Real Roster & Honest Unavailable States)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders real regular employees, shows Gaji, and hides unverified formulas', async () => {
    vi.mocked(crmService.getEmployees).mockResolvedValueOnce({
      ok: true,
      total: 2,
      sundaze_count: 1,
      redbox_count: 1,
      employees: [
        {
          id: 'emp-1',
          employee_code: 'SD-REG-001',
          name: 'Abi Bhakti',
          nickname: 'Abi',
          business_unit: 'Sundaze',
          branch: 'bypass',
          branch_name: 'Bypass',
          position: 'Barista',
          employment_type: 'regular',
          payroll_type: 'salary',
          is_active: true,
        },
        {
          id: 'emp-2',
          employee_code: 'RB-REG-001',
          name: 'Adam Apriliano',
          nickname: 'Adam',
          business_unit: 'Redbox',
          branch: 'bypass',
          branch_name: 'Bypass',
          position: 'Cashier',
          employment_type: 'regular',
          payroll_type: 'salary',
          is_active: true,
        },
      ],
    });

    render(<RegularPayroll />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Abi Bhakti')).toBeInTheDocument();
    });

    // Verify NO DemoBadge
    expect(screen.queryByText(/DEMO/i)).toBeNull();

    // Verify NO fake Nadia Kusuma or invented Rp amounts
    expect(screen.queryByText('Nadia Kusuma')).toBeNull();
    expect(screen.queryByText(/Rp\s*6\.500\.000/i)).toBeNull();

    // Verify real fields
    expect(screen.getByText('Adam Apriliano')).toBeInTheDocument();
    expect(screen.getByText('Barista')).toBeInTheDocument();
    expect(screen.getByText('Cashier')).toBeInTheDocument();

    // Verify payroll type displays "Gaji"
    expect(screen.getAllByText('Gaji').length).toBeGreaterThan(0);

    // Verify honest unavailable states for unvalidated payroll formula
    expect(screen.getAllByText('Formula belum tervalidasi').length).toBeGreaterThan(0);
  });
});
