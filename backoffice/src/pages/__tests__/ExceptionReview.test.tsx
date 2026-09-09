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
});
