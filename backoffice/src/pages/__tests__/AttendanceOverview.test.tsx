import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AttendanceOverview } from '../AttendanceOverview';

const mockOverviewResponse = {
  ok: true,
  date: '2026-08-05',
  branch: 'all',
  filter: {
    person_type: 'all',
    status: 'all',
  },
  stats: {
    total_workforce: 3,
    hadir: 2,
    terlambat: 1,
    belum_check_in: 1,
    tidak_hadir: 0,
    missing_clock_in: 0,
    missing_clock_out: 0,
    exceptions_count: 2,
  },
  records: [
    {
      id: 'barber-csb-beta',
      person_type: 'barber',
      person_id: 'csb-beta',
      name: 'Barber Beta',
      nickname: null,
      position: 'Kapster',
      branch: 'csb',
      business_unit: 'Redbox',
      date: '2026-08-05',
      status: 'hadir',
      first_check_in: '10:00',
      last_check_out: '21:00',
      total_hours: '11.0 jam',
      late_minutes: 0,
      overtime_minutes: 0,
      raw_punches: ['10:00', '21:00'],
      has_single_punch: false,
      notes: null,
    },
    {
      id: 'emp-jumadi',
      person_type: 'employee',
      person_id: 'emp-jumadi-uuid',
      name: 'Jumadi',
      nickname: null,
      position: 'Staff',
      branch: 'sumber',
      business_unit: 'Redbox',
      date: '2026-08-05',
      status: 'terlambat',
      first_check_in: '10:15',
      last_check_out: '21:30',
      total_hours: '11.3 jam',
      late_minutes: 15,
      overtime_minutes: 0,
      raw_punches: ['10:15', '21:30'],
      has_single_punch: false,
      notes: null,
    },
    {
      id: 'barber-bypass-dul',
      person_type: 'barber',
      person_id: 'bypass-dul',
      name: 'Abdul',
      nickname: null,
      position: 'Kapster',
      branch: 'bypass',
      business_unit: 'Redbox',
      date: '2026-08-05',
      status: 'belum_check_in',
      first_check_in: null,
      last_check_out: null,
      total_hours: null,
      late_minutes: 0,
      overtime_minutes: 0,
      raw_punches: [],
      has_single_punch: false,
      notes: null,
    },
  ],
};

describe('AttendanceOverview', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/crm/attendance/overview')) {
        return Promise.resolve(
          new Response(JSON.stringify(mockOverviewResponse), { status: 200 })
        );
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has no fake fixtures and no DemoBadge', async () => {
    render(<AttendanceOverview />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Attendance Command Center')).toBeInTheDocument();
    });

    // Verify NO DemoBadge
    expect(screen.queryByText(/DEMO/i)).toBeNull();

    // Verify NO fake fixtures
    expect(screen.queryByText('Dodi Iskandar')).toBeNull();
    expect(screen.queryByText('Rizky Pratama')).toBeNull();
    expect(screen.queryByText('Andra Wijaya')).toBeNull();
  });

  it('renders attendance sourced from real API data for both regular staff and barbers', async () => {
    render(<AttendanceOverview />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Barber Beta')).toBeInTheDocument();
      expect(screen.getByText('Jumadi')).toBeInTheDocument();
      expect(screen.getByText('Abdul')).toBeInTheDocument();
    });

    // Check branch and position
    expect(screen.getAllByText('Kapster').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Staff').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CSB').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sumber').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bypass').length).toBeGreaterThan(0);

    // Check punches and total hours
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('11.0 jam')).toBeInTheDocument();
    expect(screen.getByText('+15 mnt')).toBeInTheDocument();
  });

  it('renders KPI cards from API stats', async () => {
    render(<AttendanceOverview />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Hadir (3 Total)')).toBeInTheDocument();
      expect(screen.getByText('Terlambat Masuk')).toBeInTheDocument();
    });
  });

  it('links Exception card to /attendance/exceptions', async () => {
    render(<AttendanceOverview />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Exception / Anomali →')).toBeInTheDocument();
    });

    const link = screen.getByRole('link', { name: /Exception \/ Anomali/i });
    expect(link.getAttribute('href')).toBe('/attendance/exceptions');
  });
});
