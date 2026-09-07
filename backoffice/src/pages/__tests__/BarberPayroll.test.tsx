import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BarberPayroll } from '../BarberPayroll';
import * as crmService from '../../services/crm';

vi.mock('../../services/crm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/crm')>();
  return {
    ...actual,
    getCommandCenterForBranch: vi.fn(),
  };
});

describe('BarberPayroll (Real Barber Roster & Bagi Hasil)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders real barbers with Bagi Hasil and no hardcoded payouts or DemoBadge', async () => {
    vi.mocked(crmService.getCommandCenterForBranch).mockImplementation(async (branch) => {
      const branchBarbers = {
        csb: [{ id: 'csb-indra', name: 'Indra Gunawan', branch: 'csb' }],
        sumber: [{ id: 'sumber-asep', name: 'Asep Saepudin', branch: 'sumber' }],
      }[branch] || [];

      return {
        branch: { slug: branch, name: branch },
        stats: { booking_today: 0, pending: 0, belum_check_in: 0, hadir: 0, tidak_hadir: 0 },
        barbers: branchBarbers as any,
        booking_feed: [],
        alerts: [],
      } as unknown as crmService.CommandCenterBranchData;
    });

    render(<BarberPayroll />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Indra Gunawan')).toBeInTheDocument();
    });

    // Verify NO DemoBadge
    expect(screen.queryByText(/DEMO/i)).toBeNull();

    // Verify NO fake Ubay Santoso or fake payment amounts
    expect(screen.queryByText('Ubay Santoso')).toBeNull();
    expect(screen.queryByText(/Rp\s*5\.640\.000/i)).toBeNull();

    // Verify real barbers appear
    expect(screen.getByText('Asep Saepudin')).toBeInTheDocument();

    // Verify payroll type is "Bagi Hasil"
    expect(screen.getAllByText('Bagi Hasil').length).toBeGreaterThan(0);

    // Verify honest unvalidated formula state
    expect(screen.getAllByText('Formula bagi hasil belum tervalidasi').length).toBeGreaterThan(0);
  });
});
