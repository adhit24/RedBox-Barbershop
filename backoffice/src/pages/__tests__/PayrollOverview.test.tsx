import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PayrollOverview } from '../PayrollOverview';
import * as crmService from '../../services/crm';

vi.mock('../../services/crm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/crm')>();
  return {
    ...actual,
    getEmployees: vi.fn(),
    getCommandCenterForBranch: vi.fn(),
  };
});

describe('PayrollOverview (Dynamic Counts & Honest States)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dynamic counts without DemoBadge or fake review numbers', async () => {
    vi.mocked(crmService.getEmployees).mockResolvedValueOnce({
      ok: true,
      total: 39,
      sundaze_count: 23,
      redbox_count: 16,
      employees: Array.from({ length: 39 }, (_, i) => ({
        id: `emp-${i}`,
        employee_code: `RB-${i}`,
        name: `Employee ${i}`,
        nickname: null,
        business_unit: i < 23 ? 'Sundaze' : 'Redbox',
        branch: 'bypass',
        branch_name: 'Bypass',
        position: 'Staff',
        employment_type: 'regular',
        payroll_type: 'Gaji',
        is_active: true,
      })),
    });

    vi.mocked(crmService.getCommandCenterForBranch).mockImplementation(async (branch) => {
      const branchBarbers = {
        bypass: [{ id: 'b1', name: 'Barber 1', branch: 'bypass' }],
        csb: [{ id: 'b2', name: 'Barber 2', branch: 'csb' }],
        samadikun: [{ id: 'b3', name: 'Barber 3', branch: 'samadikun' }],
        sumber: [{ id: 'b4', name: 'Barber 4', branch: 'sumber' }],
        tegal: [{ id: 'b5', name: 'Barber 5', branch: 'tegal' }],
      }[branch] || [];

      return {
        branch: { slug: branch, name: branch },
        stats: { booking_today: 0, pending: 0, belum_check_in: 0, hadir: 0, tidak_hadir: 0 },
        barbers: branchBarbers as any,
        booking_feed: [],
        alerts: [],
      } as unknown as crmService.CommandCenterBranchData;
    });

    render(<PayrollOverview />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Total Tenaga Kerja Aktif')).toBeInTheDocument();
    });

    // Verify NO DemoBadge
    expect(screen.queryByText(/DEMO/i)).toBeNull();

    // Verify dynamic counts: 39 regular + 5 mock barbers = 44
    expect(screen.getByText('44')).toBeInTheDocument();
    expect(screen.getByText('Karyawan Reguler (Gaji) →')).toBeInTheDocument();
    expect(screen.getByText('Kapster (Bagi Hasil) →')).toBeInTheDocument();

    // Verify honest unavailable states for pending review and adjustments (NO fake 4 pending / 2 adjustments)
    expect(screen.getAllByText('Belum tersedia').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('4 pending')).toBeNull();
    expect(screen.queryByText('2 adjustments')).toBeNull();
  });
});
