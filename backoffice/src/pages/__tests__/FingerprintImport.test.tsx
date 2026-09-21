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

  it('smoke-tests Tegal attendance import UI: preview and cancel flow', async () => {
    const mockTegalPreview = {
      filename: 'tegalsept.xls',
      file_hash: 'mockhash123456789',
      format: 'tegal_horizontal_report',
      detected_format: 'tegal_horizontal_report',
      period: { from: '2026-08-26', to: '2026-09-19' },
      employees_detected: 13,
      matched_count: 2,
      unmatched_count: 11,
      punch_records_count: 192,
      warnings_count: 1,
      warnings: [{ type: 'unmatched_employees', message: '11 karyawan belum terhubung ke database' }],
      matched: [
        { external_employee_id: '1', external_name: 'Ahmad', department: 'Dept1', target_name: 'Ahmad Syarif', target_type: 'employee' },
      ],
      unmatched: [
        { external_employee_id: '4', external_name: 'shepril', department: 'Dept1' },
      ],
      sample_records: [
        { external_employee_id: '1', name: 'Ahmad', date: '2026-08-26', first_check_in: '09:59', last_check_out: '20:56', punches: ['09:59', '14:53', '15:22', '20:56'], late_minutes: 0, derived_status: 'hadir' },
      ],
    };

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/crm/attendance/import/batches')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, batches: [] }), { status: 200 }));
      }
      if (url.includes('/api/admin/crm/attendance/import/preview')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: mockTegalPreview }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }));

    class MockFileReader {
      result = 'data:application/vnd.ms-excel;base64,bW9jaw==';
      onload: (() => void) | null = null;
      readAsDataURL() {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 10);
      }
    }
    vi.stubGlobal('FileReader', MockFileReader);

    render(<FingerprintImport />, { wrapper: MemoryRouter });

    await waitFor(() => {
      expect(screen.getByText('Import Fingerprint')).toBeInTheDocument();
    });

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(document.getElementById('fingerprint-machine-select') as HTMLSelectElement, { target: { value: 'tegal' } });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const mockFile = new File(['mock content'], 'tegalsept.xls', { type: 'application/vnd.ms-excel' });
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    // Verify preview renders
    await waitFor(() => {
      expect(screen.getByText('Stage 2 — Preview Only')).toBeInTheDocument();
      expect(screen.getByText('tegalsept.xls')).toBeInTheDocument();
      expect(screen.getByText('2026-08-26 — 2026-09-19')).toBeInTheDocument();
      expect(screen.getByText('13')).toBeInTheDocument(); // Karyawan terdeteksi
      expect(screen.getByText('192')).toBeInTheDocument(); // Record presensi
    });

    // Test Batal (Cancel preview)
    const cancelButton = screen.getByRole('button', { name: 'Batal' });
    fireEvent.click(cancelButton);

    // Verify reset to stage 1 (SELECT) with zero mutation
    await waitFor(() => {
      expect(screen.getByText('Pilih File Fingerprint')).toBeInTheDocument();
      expect(screen.queryByText('Stage 2 — Preview Only')).toBeNull();
    });
  });

  it('smoke-tests Tegal attendance import UI: commit flow', async () => {
    const mockTegalPreview = {
      filename: 'tegalsept.xls',
      file_hash: 'mockhash123456789',
      format: 'tegal_horizontal_report',
      detected_format: 'tegal_horizontal_report',
      period: { from: '2026-08-26', to: '2026-09-19' },
      employees_detected: 13,
      matched_count: 2,
      unmatched_count: 11,
      punch_records_count: 192,
      warnings_count: 0,
      warnings: [],
      matched: [],
      unmatched: [],
      sample_records: [],
    };

    let commitCalled = false;
    const sentBodies: Record<string, any> = {};

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/admin/crm/attendance/import/batches')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, batches: [] }), { status: 200 }));
      }
      if (url.includes('/api/admin/crm/attendance/import/preview')) {
        sentBodies.preview = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: mockTegalPreview }), { status: 200 }));
      }
      if (url.includes('/api/admin/crm/attendance/import/commit')) {
        sentBodies.commit = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
        commitCalled = true;
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          data: {
            batch_id: 'batch-tegal-uuid',
            status: 'completed',
            period: mockTegalPreview.period,
            employees_detected: 13,
            matched_count: 2,
            unmatched_count: 11,
            rows_imported: 192,
            rows_exceptions: 0,
            message: 'Impor berhasil disimpan',
          },
        }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }));

    class MockFileReader {
      result = 'data:application/vnd.ms-excel;base64,bW9jaw==';
      onload: (() => void) | null = null;
      readAsDataURL() {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 10);
      }
    }
    vi.stubGlobal('FileReader', MockFileReader);

    render(<FingerprintImport />, { wrapper: MemoryRouter });

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(document.getElementById('fingerprint-machine-select') as HTMLSelectElement, { target: { value: 'tegal' } });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const mockFile = new File(['mock content'], 'tegalsept.xls', { type: 'application/vnd.ms-excel' });
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await waitFor(() => {
      expect(screen.getByText('Stage 2 — Preview Only')).toBeInTheDocument();
    });

    // Click commit
    const commitButton = screen.getByRole('button', { name: 'Import Attendance' });
    fireEvent.click(commitButton);

    await waitFor(() => {
      expect(screen.getByText(/Impor Berhasil Disimpan/i)).toBeInTheDocument();
      expect(commitCalled).toBe(true);
      expect(sentBodies.preview.machine_source).toBe('tegal');
      expect(sentBodies.commit.machine_source).toBe('tegal');
      expect(sentBodies.commit.preview_machine_source).toBe('tegal');
    });
  });

  it('requires an explicit machine: file input disabled and no preview request without selection', async () => {
    let previewCalls = 0;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/import/batches')) return Promise.resolve(new Response(JSON.stringify({ ok: true, batches: [] }), { status: 200 }));
      if (url.includes('/import/preview')) previewCalls += 1;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }));
    render(<FingerprintImport />, { wrapper: MemoryRouter });
    await waitFor(() => expect(screen.getByText('Import Fingerprint')).toBeInTheDocument());
    const select = document.getElementById('fingerprint-machine-select') as HTMLSelectElement;
    expect(select.value).toBe('');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.disabled).toBe(true);
    expect(previewCalls).toBe(0);
  });
});
