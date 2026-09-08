import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

vi.mock('../auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    currentUser: { label: 'Owner User', role: 'owner' },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
  }),
}));

const mockEmployees = [
  {
    id: 'emp-sd-001',
    employee_code: 'SD-REG-001',
    name: 'Employee Alpha',
    nickname: 'Abi',
    business_unit: 'Sundaze',
    branch: 'bypass',
    position: 'Barista',
    employment_type: 'regular',
    payroll_type: 'salary',
    is_active: true,
  },
];

const mockBarbers = [
  { id: 'csb-ubay', name: 'Ubay', branch: 'csb', attendance_status: 'hadir', today_count: 3 },
  { id: 'bypass-abdul', name: 'Abdul', branch: 'bypass', attendance_status: 'hadir', today_count: 2 },
];

function setupFetchMock(options: { roleStatus?: number; employeeFound?: boolean } = {}) {
  const { roleStatus = 200, employeeFound = true } = options;

  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('/api/admin/crm/role-counts')) {
      if (roleStatus === 403) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            roles: { owner: 2, branch_admin: 5, manager: 0, hr: 0 },
          }),
          { status: 200 }
        )
      );
    }

    if (url.includes('/api/admin/crm/employees/emp-not-found')) {
      return Promise.resolve(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
    }

    if (url.includes('/api/admin/crm/employees/emp-sd-001')) {
      if (!employeeFound) return Promise.resolve(new Response('Not found', { status: 404 }));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            type: 'regular',
            person: {
              id: 'emp-sd-001',
              code: 'SD-REG-001',
              name: 'Employee Alpha',
              nickname: 'Abi',
              business_unit: 'Sundaze',
              branch: 'bypass',
              branch_name: 'Bypass',
              position: 'Barista',
              employment_type: 'regular',
              payroll_type: 'Gaji',
              is_active: true,
              join_date: '2025-08-01',
            },
          }),
          { status: 200 }
        )
      );
    }

    if (url.includes('/api/admin/crm/employees/barber-csb-ubay')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            type: 'barber',
            person: {
              id: 'barber-csb-ubay',
              code: 'csb-ubay',
              name: 'Ubay',
              nickname: null,
              business_unit: 'Redbox Barbershop',
              branch: 'csb',
              branch_name: 'CSB Mall',
              position: 'Kapster',
              employment_type: 'contract',
              payroll_type: 'Bagi Hasil',
              is_active: true,
              join_date: null,
            },
          }),
          { status: 200 }
        )
      );
    }

    if (url.includes('/api/admin/crm/employees')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            total: 1,
            sundaze_count: 1,
            redbox_count: 0,
            employees: mockEmployees,
          }),
          { status: 200 }
        )
      );
    }

    if (url.includes('command-center')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            stats: { hadir: 2, tidak_hadir: 0, belum_check_in: 0, booking_today: 3, pending: 1 },
            barbers: mockBarbers,
            home_service: [],
            booking_feed: [],
            moka_open_bills: [],
            alerts: [],
          }),
          { status: 200 }
        )
      );
    }

    if (url.includes('owner-overview')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            today: '2026-09-07',
            branches: [{ slug: 'csb', name: 'CSB', revenue_moka: 0, tx_moka: 0, revenue_web: 0, tx_web: 0, hadir: 1, total_barbers: 1 }],
            totals: { revenue_moka: 0, revenue_web: 0, tx_total: 0, hadir: 1, goshow: 0, pending: 0 },
          }),
          { status: 200 }
        )
      );
    }

    if (url.includes('segments')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data_coverage: { from: '2026-01-01', to: '2026-09-01' },
            kpis: { active_customers: 10, new_customers: 2, repeat_customers: 5, loyal_customers: 2, dormant_customers: 3, avg_visit_interval_days: 14 },
            segments: [{ key: 'repeat', label: 'Repeat', count: 5 }],
            customers: { items: [], total: 0, limit: 50, offset: 0 },
          }),
          { status: 200 }
        )
      );
    }

    if (url.includes('membership')) {
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }

    if (url.includes('status')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            oauthConfigured: true,
            outlets: [{ id: 'o1', name: 'CSB', hasToken: true, tokenExpired: false }],
            recentLogs: [],
          }),
          { status: 200 }
        )
      );
    }

    if (url.includes('sync-logs') || url.includes('sync-log')) {
      return Promise.resolve(new Response(JSON.stringify({ logs: [], total: 0 }), { status: 200 }));
    }

    if (url.includes('barber-performance')) {
      return Promise.resolve(new Response(JSON.stringify({ period: 'today', total_customers: 0, barbers: [] }), { status: 200 }));
    }

    if (url.includes('branch-activity')) {
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    }

    if (url.includes('branch-compare')) {
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }

    return Promise.resolve(new Response('{}', { status: 200 }));
  }));
}

describe('Backoffice Route Smoke Test', () => {
  beforeEach(() => {
    setupFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('smoke-tests Command Center root route (/)', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getAllByText('Command Center').length).toBeGreaterThan(0);
    });
  });

  it('smoke-tests Operations route (/operations)', async () => {
    render(
      <MemoryRouter initialEntries={['/operations']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Operations' })).toBeInTheDocument();
    });
  });

  it('smoke-tests HR roster route (/hr)', async () => {
    render(
      <MemoryRouter initialEntries={['/hr']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'HR & People' })).toBeInTheDocument();
    });
  });

  it('smoke-tests regular employee detail route (/hr/employees/emp-sd-001)', async () => {
    render(
      <MemoryRouter initialEntries={['/hr/employees/emp-sd-001']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Employee Alpha' })).toBeInTheDocument();
      expect(screen.getByText('SD-REG-001')).toBeInTheDocument();
    });
  });

  it('smoke-tests barber employee detail route (/hr/employees/barber-csb-ubay)', async () => {
    render(
      <MemoryRouter initialEntries={['/hr/employees/barber-csb-ubay']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Ubay' })).toBeInTheDocument();
      expect(screen.getByText('Bagi Hasil')).toBeInTheDocument();
    });
  });

  it('smoke-tests 404 personnel route (/hr/employees/emp-not-found)', async () => {
    render(
      <MemoryRouter initialEntries={['/hr/employees/emp-not-found']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText('Karyawan tidak ditemukan')).toBeInTheDocument();
    });
  });

  it('smoke-tests attendance overview route (/attendance)', async () => {
    render(
      <MemoryRouter initialEntries={['/attendance']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText('Kehadiran Kapster Hari Ini')).toBeInTheDocument();
      expect(screen.getByText('Data fingerprint karyawan reguler belum terhubung')).toBeInTheDocument();
    });
  });

  it('smoke-tests fingerprint import route (/attendance/import)', async () => {
    render(
      <MemoryRouter initialEntries={['/attendance/import']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Import Fingerprint' })).toBeInTheDocument();
      expect(screen.getByText('Belum terhubung')).toBeInTheDocument();
    });
  });

  it('smoke-tests exception review route (/attendance/exceptions)', async () => {
    render(
      <MemoryRouter initialEntries={['/attendance/exceptions']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Exception Review' })).toBeInTheDocument();
      expect(screen.getByText('Belum ada data exception yang terhubung')).toBeInTheDocument();
    });
  });

  it('smoke-tests attendance report route (/reports/attendance)', async () => {
    render(
      <MemoryRouter initialEntries={['/reports/attendance']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Laporan Kehadiran Kapster' })).toBeInTheDocument();
    });
  });

  it('smoke-tests payroll overview route (/payroll)', async () => {
    render(
      <MemoryRouter initialEntries={['/payroll']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Payroll' })).toBeInTheDocument();
    });
  });

  it('smoke-tests regular payroll route (/payroll/regular)', async () => {
    render(
      <MemoryRouter initialEntries={['/payroll/regular']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Regular Payroll' })).toBeInTheDocument();
    });
  });

  it('smoke-tests barber payroll route (/payroll/barber)', async () => {
    render(
      <MemoryRouter initialEntries={['/payroll/barber']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Barber Payroll' })).toBeInTheDocument();
    });
  });

  it('smoke-tests payroll employee detail route (/payroll/employees/emp-sd-001)', async () => {
    render(
      <MemoryRouter initialEntries={['/payroll/employees/emp-sd-001']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText('Rincian Kompensasi & Komisi Periode Ini')).toBeInTheDocument();
    });
  });

  it('smoke-tests CRM overview route (/crm)', async () => {
    render(
      <MemoryRouter initialEntries={['/crm']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'CRM & Customer' })).toBeInTheDocument();
      expect(screen.getByText('Daftar Pelanggan')).toBeInTheDocument();
    });
  });

  it('smoke-tests reports overview route (/reports)', async () => {
    render(
      <MemoryRouter initialEntries={['/reports']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument();
    });
  });

  it('smoke-tests system roles route with success (/system/roles)', async () => {
    render(
      <MemoryRouter initialEntries={['/system/roles']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Peran & Izin' })).toBeInTheDocument();
      expect(screen.getByText('2 akun terdaftar')).toBeInTheDocument();
      expect(screen.getByText('Rancangan Matriks Akses')).toBeInTheDocument();
    });
  });

  it('smoke-tests system roles route 403 forbidden state (/system/roles)', async () => {
    setupFetchMock({ roleStatus: 403 });
    render(
      <MemoryRouter initialEntries={['/system/roles']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText(/Hanya akun dengan peran Owner yang memiliki otorisasi/i)).toBeInTheDocument();
    });
  });

  it('smoke-tests Moka integration route (/moka)', async () => {
    render(
      <MemoryRouter initialEntries={['/moka']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Moka POS Integration' })).toBeInTheDocument();
    });
  });

  it('smoke-tests stockist route (/stockist)', async () => {
    render(
      <MemoryRouter initialEntries={['/stockist']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Stockist & Inventory' })).toBeInTheDocument();
      expect(screen.getByText('Open Stockist Application ↗')).toBeInTheDocument();
      expect(screen.getByText(/Data Stockist belum bisa diakses dari Backoffice/i)).toBeInTheDocument();
    });
  });
});
