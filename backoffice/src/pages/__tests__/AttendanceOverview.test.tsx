import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AttendanceOverview } from '../AttendanceOverview';

const mockBranchCommandCenter: Record<string, unknown> = {
  bypass: {
    stats: { hadir: 1, belum_check_in: 0, tidak_hadir: 0 },
    barbers: [
      { id: 'b-bypass-1', name: 'Barber Alpha', branch: 'bypass', attendance_status: 'hadir', today_count: 4 },
    ],
  },
  csb: {
    stats: { hadir: 1, belum_check_in: 1, tidak_hadir: 0 },
    barbers: [
      { id: 'b-csb-1', name: 'Barber Beta', branch: 'csb', attendance_status: 'hadir', today_count: 5 },
      { id: 'b-csb-2', name: 'Barber Gamma', branch: 'csb', attendance_status: 'terlambat', today_count: 2 },
    ],
  },
  samadikun: {
    stats: { hadir: 0, belum_check_in: 1, tidak_hadir: 0 },
    barbers: [
      { id: 'b-samadikun-1', name: 'Barber Delta', branch: 'samadikun', attendance_status: 'belum_check_in', today_count: 0 },
    ],
  },
  sumber: {
    stats: { hadir: 1, belum_check_in: 0, tidak_hadir: 0 },
    barbers: [
      { id: 'b-sumber-1', name: 'Barber Epsilon', branch: 'sumber', attendance_status: 'hadir', today_count: 3 },
    ],
  },
  tegal: {
    stats: { hadir: 0, belum_check_in: 0, tidak_hadir: 1 },
    barbers: [
      { id: 'b-tegal-1', name: 'Barber Foxtrot', branch: 'tegal', attendance_status: 'tidak_hadir', today_count: 0 },
    ],
  },
};

describe('AttendanceOverview', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      for (const branch of ['bypass', 'csb', 'samadikun', 'sumber', 'tegal']) {
        if (url.includes(`branch=${branch}`)) {
          return Promise.resolve(
            new Response(JSON.stringify(mockBranchCommandCenter[branch]), { status: 200 })
          );
        }
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has no fake employee fixtures and no DemoBadge', async () => {
    render(<AttendanceOverview />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Kehadiran Kapster Hari Ini')).toBeInTheDocument();
    });

    // Verify NO DemoBadge
    expect(screen.queryByText(/DEMO/i)).toBeNull();

    // Verify NO fake fixtures
    expect(screen.queryByText('Dodi Iskandar')).toBeNull();
    expect(screen.queryByText('Rizky Pratama')).toBeNull();
    expect(screen.queryByText('Andra Wijaya')).toBeNull();
  });

  it('renders barber attendance sourced from real API data', async () => {
    render(<AttendanceOverview />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Barber Alpha')).toBeInTheDocument();
      expect(screen.getByText('Barber Beta')).toBeInTheDocument();
      expect(screen.getByText('Barber Gamma')).toBeInTheDocument();
    });

    // Check status labels and service counts
    expect(screen.getByText('5 layanan')).toBeInTheDocument();
    expect(screen.getByText('4 layanan')).toBeInTheDocument();
  });

  it('displays honest unavailable state for regular fingerprint attendance', async () => {
    render(<AttendanceOverview />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Data fingerprint karyawan reguler belum terhubung')).toBeInTheDocument();
      expect(screen.getByText(/format mesin absensi tervalidasi|tahap perancangan format data/i)).toBeInTheDocument();
      expect(screen.getByText('Belum terhubung')).toBeInTheDocument();
    });
  });

  it('links Exception card to /attendance/exceptions with honest unavailable state', async () => {
    render(<AttendanceOverview />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Exception Attendance →')).toBeInTheDocument();
    });

    const link = screen.getByRole('link', { name: /Exception Attendance/i });
    expect(link.getAttribute('href')).toBe('/attendance/exceptions');
    expect(screen.getByText('Belum tersedia')).toBeInTheDocument();
  });
});
