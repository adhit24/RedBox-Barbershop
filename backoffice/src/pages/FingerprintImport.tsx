import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';

export function FingerprintImport() {
  return (
    <>
      <Link
        to="/attendance"
        className="mb-4 inline-block text-sm font-semibold text-rb-text-muted hover:text-rb-text"
      >
        ← Kembali ke Attendance
      </Link>
      <PageHeader
        title="Import Fingerprint"
        subtitle="Unggah dan proses rekaman mesin absensi fingerprint karyawan reguler"
        actions={
          <span className="rounded-rb-pill bg-rb-divider px-2.5 py-1 text-[11px] font-semibold text-rb-text-muted">
            Belum terhubung
          </span>
        }
      />

      <div className="mb-6 rounded-rb-card border border-rb-border bg-rb-surface p-6">
        <EmptyState
          title="Riwayat impor mesin fingerprint belum tersedia"
          description="Modul upload dan parsing akan diaktifkan setelah format mesin absensi tervalidasi. Backoffice tidak menyediakan riwayat atau simulasi impor tanpa data riil."
        />

        <div className="mt-6 rounded-2xl border border-dashed border-rb-border bg-rb-bg px-8 py-8 text-center opacity-60">
          <div className="mb-1 text-sm font-semibold text-rb-text">
            Upload File Fingerprint (Belum Aktif)
          </div>
          <div className="mb-3.5 text-xs text-rb-text-muted">
            Format mesin absensi sedang dalam tahap standardisasi
          </div>
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2 text-xs font-semibold text-rb-text-muted"
          >
            Pilih File (Tidak Tersedia)
          </button>
        </div>
      </div>
    </>
  );
}

