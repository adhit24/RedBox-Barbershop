import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FingerprintImport } from '../FingerprintImport';

describe('FingerprintImport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/crm/attendance/import/batches')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, batches: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }));
  });

  it('does NOT render DemoBadge or fake import counts', async () => {
    render(<FingerprintImport />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Import Fingerprint')).toBeInTheDocument();
    });

    // Verify NO DemoBadge
    expect(screen.queryByText(/DEMO/i)).toBeNull();

    // Verify NO fake import counts or stats
    expect(screen.queryByText('312')).toBeNull();
    expect(screen.queryByText(/Records Diimport/i)).toBeNull();
    expect(screen.queryByText(/Hasil Import Terakhir/i)).toBeNull();
  });

  it('renders Ready badge and active upload file selector', async () => {
    render(<FingerprintImport />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Ready')).toBeInTheDocument();
      expect(screen.getByText('Pilih File Fingerprint')).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    expect(fileInput.getAttribute('accept')).toBe('.xls,.xlsx');
  });

  it('renders honest empty state when no import history exists', async () => {
    render(<FingerprintImport />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Riwayat Impor Mesin Fingerprint')).toBeInTheDocument();
      expect(screen.getByText('Belum ada riwayat impor')).toBeInTheDocument();
    });
  });
});
