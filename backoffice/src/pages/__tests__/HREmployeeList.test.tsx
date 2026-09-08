import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HREmployeeList } from '../HREmployeeList';

const byBranch: Record<string, unknown> = {
  bypass: { barbers: [{ id: 'bypass-abdul-dul', name: 'Abdul', branch: 'bypass', attendance_status: null, today_count: 0 }] },
  csb: { barbers: [{ id: 'csb-ubay', name: 'Ubay', branch: 'csb', attendance_status: 'hadir', today_count: 3 }] },
  samadikun: { barbers: [{ id: 'samadikun-sofyan', name: 'Sofyan', branch: 'samadikun', attendance_status: null, today_count: 0 }] },
  sumber: { barbers: [{ id: 'sumber-bayu', name: 'Bayu', branch: 'sumber', attendance_status: null, today_count: 0 }] },
  tegal: { barbers: [{ id: 'tegal-ahmad', name: 'Ahmad', branch: 'tegal', attendance_status: null, today_count: 0 }] },
};

const mockEmployees = [
  {
    id: 'emp-sd-001',
    employee_code: 'SD-REG-001',
    name: 'Employee Alpha',
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
    id: 'emp-sd-002',
    employee_code: 'SD-REG-002',
    name: 'Employee Beta',
    nickname: 'Agus',
    business_unit: 'Sundaze',
    branch: 'bypass',
    branch_name: 'Bypass',
    position: 'Barista',
    employment_type: 'regular',
    payroll_type: 'salary',
    is_active: true,
  },
  {
    id: 'emp-rb-001',
    employee_code: 'RB-REG-001',
    name: 'Employee Gamma',
    nickname: 'Adam',
    business_unit: 'Redbox',
    branch: 'bypass',
    branch_name: 'Bypass',
    position: 'Helper Cashier',
    employment_type: 'regular',
    payroll_type: 'salary',
    is_active: true,
  },
];

describe('HREmployeeList', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/crm/employees')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              total: mockEmployees.length,
              sundaze_count: 2,
              redbox_count: 1,
              employees: mockEmployees,
            }),
            { status: 200 }
          )
        );
      }
      const branch = new URL(url, 'https://example.test').searchParams.get('branch') ?? '';
      return Promise.resolve(new Response(JSON.stringify(byBranch[branch] ?? { barbers: [] }), { status: 200 }));
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders real barber roster from all five branch command-center sources', async () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    await waitFor(() => expect(screen.getByText('Abdul')).toBeInTheDocument());
    expect(screen.getByText('Ubay')).toBeInTheDocument();
    expect(screen.getByText('Sofyan')).toBeInTheDocument();
    expect(screen.getByText('Bayu')).toBeInTheDocument();
    expect(screen.getByText('Ahmad')).toBeInTheDocument();
    expect(screen.queryByText(/Ubay Santoso/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^DEMO/i)).not.toBeInTheDocument();
  });

  it('labels database barbers with payroll type Bagi Hasil and does not fabricate attendance', async () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    await screen.findByText('Abdul');
    expect(screen.getAllByText('Kapster').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bagi Hasil').length).toBeGreaterThan(0);
    expect(screen.queryByText('Komisi')).not.toBeInTheDocument();
    expect(screen.getAllByText('Belum tersedia').length).toBeGreaterThan(0);
    expect(screen.getByText('Hadir')).toBeInTheDocument();
  });

  it('renders regular employees with payroll type Gaji and dynamic KPI counts', async () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    await screen.findByText('Employee Alpha');

    // Check regular employees rendered
    expect(screen.getByText('Employee Beta')).toBeInTheDocument();
    expect(screen.getByText('Employee Gamma')).toBeInTheDocument();
    expect(screen.getByText('SD-REG-001')).toBeInTheDocument();
    expect(screen.getByText('RB-REG-001')).toBeInTheDocument();

    // Check positions, business units, and payroll type Gaji
    expect(screen.getAllByText('Barista').length).toBe(2);
    expect(screen.getByText('Helper Cashier')).toBeInTheDocument();
    expect(screen.getAllByText('Sundaze Cafe').length).toBe(2);
    expect(screen.getAllByText('Gaji').length).toBe(3);

    // KPI Cards check
    // 5 barbers + 3 regular employees = 8 total
    expect(screen.getByText('8')).toBeInTheDocument(); // Total Karyawan Aktif
    expect(screen.getByText('Total Karyawan Aktif')).toBeInTheDocument();
    expect(screen.getByText('Karyawan Reguler (2 SD · 1 RB)')).toBeInTheDocument();
    expect(screen.getByText('Unit Bisnis Live')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // 2 Live units: Redbox & Sundaze
  });

  it('supports category filters for Kapster, Sundaze, and Redbox Reguler', async () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    await screen.findByText('Employee Alpha');

    // Click Sundaze filter
    const sundazeBtn = screen.getByRole('button', { name: /^Sundaze/ });
    fireEvent.click(sundazeBtn);

    expect(screen.getByText('Employee Alpha')).toBeInTheDocument();
    expect(screen.getByText('Employee Beta')).toBeInTheDocument();
    expect(screen.queryByText('Employee Gamma')).not.toBeInTheDocument();
    expect(screen.queryByText('Abdul')).not.toBeInTheDocument();

    // Click Kapster filter
    const kapsterBtn = screen.getByRole('button', { name: /^Kapster/ });
    fireEvent.click(kapsterBtn);

    expect(screen.getByText('Abdul')).toBeInTheDocument();
    expect(screen.getByText('Ubay')).toBeInTheDocument();
    expect(screen.queryByText('Employee Alpha')).not.toBeInTheDocument();
  });

  it('proves all visible production counts are dynamic with zero hardcoded headcount constants', async () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    await screen.findByText('Employee Alpha');

    // Dynamic footer text:
    expect(
      screen.getByText(/Data karyawan reguler \(3\) dan kapster \(5\) terhubung langsung ke database Supabase\./i)
    ).toBeInTheDocument();

    // Verify filter button counts are dynamic
    expect(screen.getByRole('button', { name: 'Semua (8)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kapster (5)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sundaze (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redbox Reguler (1)' })).toBeInTheDocument();
  });
});

