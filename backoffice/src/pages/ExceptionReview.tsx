import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';

export function ExceptionReview() {
  return (
    <>
      <Link
        to="/attendance"
        className="mb-4 inline-block text-sm font-semibold text-rb-text-muted hover:text-rb-text"
      >
        ← Kembali ke Attendance
      </Link>
      <PageHeader
        title="Exception Review"
        subtitle="Review keterlambatan, missing check-in/out, dan rekonsiliasi presensi"
        actions={
          <span className="rounded-rb-pill bg-rb-divider px-2.5 py-1 text-[11px] font-semibold text-rb-text-muted">
            Belum tersedia
          </span>
        }
      />

      <div className="rounded-rb-card border border-rb-border bg-rb-surface p-6">
        <EmptyState
          title="Belum ada data exception yang terhubung"
          description="Modul exception attendance belum terhubung ke database operasional. Alur persetujuan, penalti, dan pembatalan anomali presensi akan aktif setelah integrasi database absensi tersedia."
        />
      </div>
    </>
  );
}

