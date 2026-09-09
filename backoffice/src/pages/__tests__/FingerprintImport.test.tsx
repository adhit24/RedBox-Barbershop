import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FingerprintImport } from '../FingerprintImport';

describe('FingerprintImport', () => {
  it('does NOT render DemoBadge or fake import counts', () => {
    render(<FingerprintImport />, { wrapper: MemoryRouter });

    // Verify NO DemoBadge
    expect(screen.queryByText(/DEMO/i)).toBeNull();

    // Verify NO fake import counts or stats
    expect(screen.queryByText('312')).toBeNull();
    expect(screen.queryByText(/Records Diimport/i)).toBeNull();
    expect(screen.queryByText(/Karyawan Cocok/i)).toBeNull();
    expect(screen.queryByText(/Hasil Import Terakhir/i)).toBeNull();
  });

  it('renders honest unavailable empty state', () => {
    render(<FingerprintImport />, { wrapper: MemoryRouter });

    expect(screen.getByText('Import Fingerprint')).toBeInTheDocument();
    expect(screen.getByText('Belum terhubung')).toBeInTheDocument();
    expect(
      screen.getByText('Riwayat impor mesin fingerprint belum tersedia')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Modul upload dan parsing akan diaktifkan setelah format mesin absensi tervalidasi/i)
    ).toBeInTheDocument();
  });

  it('has disabled upload button clearly marked unavailable', () => {
    render(<FingerprintImport />, { wrapper: MemoryRouter });

    const btn = screen.getByRole('button', { name: /Pilih File/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/Tidak Tersedia/i);
  });
});
