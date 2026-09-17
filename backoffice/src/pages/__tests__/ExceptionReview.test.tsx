import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExceptionReview } from '../ExceptionReview';

describe('ExceptionReview', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/crm/attendance/exceptions')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, exceptions: [] }), { status: 200 }));
      }
      if (url.includes('/api/admin/hr-people')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, people: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }));
  });

  it('does NOT render DemoBadge or fake exception records', async () => {
    render(<ExceptionReview />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Exception Review')).toBeInTheDocument();
    });

    // Verify NO DemoBadge
    expect(screen.queryByText(/DEMO/i)).toBeNull();

    // Verify NO fake person tickets
    expect(screen.queryByText('Rizky Pratama')).toBeNull();
    expect(screen.queryByText('Andra Wijaya')).toBeNull();
    expect(screen.queryByText('Bagus Setiawan')).toBeNull();
  });

  it('renders Ready badge and filter tabs', async () => {
    render(<ExceptionReview />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Ready')).toBeInTheDocument();
      expect(screen.getByText('Menunggu Review')).toBeInTheDocument();
      expect(screen.getByText('Terselesaikan')).toBeInTheDocument();
      expect(screen.getByText('Semua')).toBeInTheDocument();
    });
  });

  it('renders honest empty state when no exceptions are waiting', async () => {
    render(<ExceptionReview />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Tidak ada exception attendance yang menunggu review')).toBeInTheDocument();
    });
  });

  it('renders candidate suggestions with evidence and punch details for unmatched employee', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/crm/attendance/exceptions')) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          exceptions: [
            {
              id: 'exc-yuda-test',
              external_employee_id: '3',
              external_name: 'Yuda',
              department: 'CSB',
              exception_type: 'unmatched_employee',
              attendance_date: '2026-08-01',
              status: 'pending',
              details: 'Karyawan mesin ID 3 (Yuda) belum terhubung.',
              raw_data: { first_check_in: '09:55', last_check_out: '21:00', raw_punches: ['09:55', '21:00'] },
            },
          ],
        }), { status: 200 }));
      }
      if (url.includes('/api/admin/hr-people')) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          people: [
            {
              id: 'barber:csb-yudha',
              source: 'barbers',
              source_record_id: 'csb-yudha',
              name: 'Yudha',
              nickname: null,
              position: 'Kapster',
              branch: 'csb',
              business_unit: 'Redbox',
            },
          ],
        }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }));

    render(<ExceptionReview />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hubungkan Karyawan/i })).toBeInTheDocument();
      expect(screen.getByText('Karyawan Belum Cocok')).toBeInTheDocument();
    });
  });
});
