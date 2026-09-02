import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { LiveBadge } from '../components/LiveBadge';
import { getOwnerOverview, getCommandCenterForBranch } from '../services/crm';

interface BranchAttendanceRow {
  slug: string;
  name: string;
  karyawan: number;
  hadir: number;
  terlambat: number;
  tidakHadir: number;
}

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      rows: BranchAttendanceRow[];
      totalHadir: number;
      totalTerlambat: number;
      totalTidakHadir: number;
      failedBranches: string[];
    };

export function AttendanceReport() {
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let overview;
      try {
        overview = await getOwnerOverview();
      } catch {
        if (!cancelled) setState({ status: 'error', message: 'Terjadi kesalahan memuat daftar cabang.' });
        return;
      }

      const results = await Promise.allSettled(overview.branches.map((b) => getCommandCenterForBranch(b.slug)));
      const rows: BranchAttendanceRow[] = [];
      const failedBranches: string[] = [];
      let totalHadir = 0;
      let totalTerlambat = 0;
      let totalTidakHadir = 0;

      results.forEach((result, i) => {
        const branch = overview.branches[i];
        if (result.status === 'rejected') {
          failedBranches.push(branch.name);
          return;
        }
        const data = result.value;
        const terlambat = data.barbers.filter((b) => b.attendance_status === 'terlambat').length;

        rows.push({
          slug: branch.slug,
          name: branch.name,
          karyawan: branch.total_barbers,
          hadir: data.stats.hadir,
          terlambat,
          tidakHadir: data.stats.tidak_hadir,
        });
        totalHadir += data.stats.hadir;
        totalTerlambat += terlambat;
        totalTidakHadir += data.stats.tidak_hadir;
      });

      if (!cancelled) {
        setState({ status: 'ready', rows, totalHadir, totalTerlambat, totalTidakHadir, failedBranches });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Link to="/reports" className="mb-2.5 inline-block text-sm font-semibold text-rb-text-muted">← Reports</Link>
      <PageHeader title="Attendance Report" subtitle="Ringkasan kehadiran dan exception operasional" actions={<LiveBadge partial />} />

      {state.status === 'loading' && <LoadingState label="Memuat data attendance..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          {state.failedBranches.length > 0 && (
            <div className="mb-4 rounded-rb-button border border-rb-orange-tint-fg/30 bg-rb-orange-tint-bg px-4 py-2.5 text-sm text-rb-orange-tint-fg">
              Gagal memuat data untuk: {state.failedBranches.join(', ')}. Cabang lain tetap ditampilkan.
            </div>
          )}

          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard value={state.totalHadir} label="Hadir" tint="green" />
            <StatCard value={state.totalTerlambat} label="Terlambat" tint="orange" />
            <StatCard value={state.totalTidakHadir} label="Tidak Hadir" tint="red" />
            <StatCard value="—" label="Attendance Exceptions" trend="Belum tersedia" tint="blue" />
          </section>

          <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
            <div className="grid grid-cols-6 gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
              <div>Cabang</div><div>Karyawan</div><div>Hadir</div><div>Terlambat</div><div>Tidak Hadir</div><div>Exception</div>
            </div>
            <div className="flex flex-col divide-y divide-rb-divider">
              {state.rows.map((r) => (
                <div key={r.slug} className="grid grid-cols-6 items-center gap-2 px-4 py-3 text-sm">
                  <div className="font-semibold text-rb-text">{r.name}</div>
                  <div className="text-rb-text-secondary">{r.karyawan}</div>
                  <div className="text-rb-text-secondary">{r.hadir}</div>
                  <div className="text-rb-text-secondary">{r.terlambat}</div>
                  <div className="text-rb-text-secondary">{r.tidakHadir}</div>
                  <div className="text-rb-text-faint">Belum tersedia</div>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-4 text-[11.5px] text-rb-text-faint">
            Hadir/Terlambat/Tidak Hadir bersumber dari status booking-day barber (data hari ini, lintas cabang).
            Attendance Exceptions belum bersumber dari sistem produksi — modul Attendance HR khusus (check-in/
            check-out fingerprint) masih memakai data contoh, belum representatif untuk laporan ini.
          </p>
        </>
      )}
    </>
  );
}
