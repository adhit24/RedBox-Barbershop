import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { getCommandCenterForBranch, type CommandCenterBarber } from '../services/crm';

const BRANCHES = ['bypass', 'csb', 'samadikun', 'sumber', 'tegal'] as const;
const BRANCH_LABELS: Record<string, string> = {
  bypass: 'Bypass',
  csb: 'CSB',
  samadikun: 'Samadikun',
  sumber: 'Sumber',
  tegal: 'Tegal',
};

function attendanceLabel(status: string | null) {
  if (!status) return 'Belum tersedia';
  const normalized = status.trim().toLowerCase();
  if (normalized === 'hadir') return 'Hadir';
  if (normalized === 'tidak_hadir') return 'Tidak hadir';
  if (normalized === 'terlambat') return 'Terlambat';
  if (normalized === 'belum_check_in') return 'Belum check-in';
  return status.replaceAll('_', ' ');
}

function statusBadgeTint(status: string | null) {
  if (!status) return 'bg-rb-divider text-rb-text-muted';
  const normalized = status.trim().toLowerCase();
  if (normalized === 'hadir') return 'bg-rb-green-tint-bg text-rb-green-tint-fg';
  if (normalized === 'terlambat') return 'bg-rb-orange-tint-bg text-rb-orange-tint-fg';
  if (normalized === 'tidak_hadir') return 'bg-rb-red-tint-bg text-rb-red-tint-fg';
  return 'bg-rb-divider text-rb-text-muted';
}

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      barbers: CommandCenterBarber[];
      totalHadir: number;
      totalTerlambat: number;
      totalBelumCheckIn: number;
      totalTidakHadir: number;
    };

export function AttendanceOverview() {
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [selectedBranch, setSelectedBranch] = useState<string>('all');

  useEffect(() => {
    Promise.allSettled(BRANCHES.map((b) => getCommandCenterForBranch(b))).then(
      (results) => {
        const barberMap = new Map<string, CommandCenterBarber>();
        let totalHadir = 0;
        let totalTerlambat = 0;
        let totalBelumCheckIn = 0;
        let totalTidakHadir = 0;

        for (const res of results) {
          if (res.status === 'fulfilled' && res.value) {
            const data = res.value;
            totalHadir += data.stats.hadir || 0;
            totalBelumCheckIn += data.stats.belum_check_in || 0;
            totalTidakHadir += data.stats.tidak_hadir || 0;

            for (const barber of data.barbers || []) {
              if (!barberMap.has(barber.id)) {
                barberMap.set(barber.id, barber);
                if (barber.attendance_status === 'terlambat') {
                  totalTerlambat++;
                }
              }
            }
          }
        }

        const barbers = [...barberMap.values()].sort((a, b) => {
          const branchDiff =
            BRANCHES.indexOf(a.branch as (typeof BRANCHES)[number]) -
            BRANCHES.indexOf(b.branch as (typeof BRANCHES)[number]);
          if (branchDiff !== 0) return branchDiff;
          return a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });
        });

        if (barbers.length === 0) {
          setState({
            status: 'error',
            message: 'Data attendance kapster belum dapat dimuat dari cabang.',
          });
          return;
        }

        setState({
          status: 'ready',
          barbers,
          totalHadir,
          totalTerlambat,
          totalBelumCheckIn,
          totalTidakHadir,
        });
      }
    );
  }, []);

  const filteredBarbers = useMemo(() => {
    if (state.status !== 'ready') return [];
    if (selectedBranch === 'all') return state.barbers;
    return state.barbers.filter((b) => b.branch === selectedBranch);
  }, [state, selectedBranch]);

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle="Monitoring kehadiran kapster real-time di seluruh cabang. Absensi fingerprint karyawan reguler dalam persiapan."
      />

      {state.status === 'loading' && (
        <LoadingState label="Memuat status kehadiran kapster dari seluruh cabang..." />
      )}

      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              value={state.totalHadir}
              label="Kapster Hadir"
              tint="green"
            />
            <StatCard
              value={state.totalTerlambat}
              label="Kapster Terlambat"
              tint="orange"
            />
            <StatCard
              value={state.totalBelumCheckIn}
              label="Belum Check-in"
              tint="yellow"
            />
            <Link to="/attendance/exceptions" className="block no-underline">
              <StatCard
                value="—"
                label="Exception Attendance →"
                trend="Belum tersedia"
                tint="blue"
              />
            </Link>
          </section>

          {/* Barber Attendance Roster */}
          <div className="mb-6 overflow-hidden rounded-rb-card border border-rb-border bg-rb-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rb-divider px-4 py-3">
              <div>
                <h2 className="font-serif text-base font-semibold text-rb-text">
                  Kehadiran Kapster Hari Ini
                </h2>
                <div className="text-xs text-rb-text-muted">
                  Berdasarkan status check-in terminal Command Center cabang
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="branch-filter" className="text-xs text-rb-text-muted">
                  Cabang:
                </label>
                <select
                  id="branch-filter"
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs font-semibold text-rb-text"
                >
                  <option value="all">Semua Cabang ({state.barbers.length})</option>
                  {BRANCHES.map((b) => {
                    const count = state.barbers.filter((barber) => barber.branch === b).length;
                    return (
                      <option key={b} value={b}>
                        {BRANCH_LABELS[b]} ({count})
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
              <div>Kapster</div>
              <div>Cabang</div>
              <div>Status Kehadiran</div>
              <div>Layanan Hari Ini</div>
            </div>

            <div className="flex flex-col divide-y divide-rb-divider">
              {filteredBarbers.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-rb-text-muted">
                  Tidak ada data kapster pada cabang yang dipilih.
                </div>
              ) : (
                filteredBarbers.map((barber) => (
                  <div
                    key={barber.id}
                    className="grid grid-cols-[1.5fr_1fr_1fr_1fr] items-center gap-2 px-4 py-3 text-sm"
                  >
                    <div>
                      <Link
                        to={`/hr/employees/barber-${barber.id}`}
                        className="font-semibold capitalize text-rb-text hover:text-rb-red hover:underline"
                      >
                        {barber.name}
                      </Link>
                      <div className="text-[11px] font-mono text-rb-text-faint">
                        {barber.id}
                      </div>
                    </div>
                    <div className="capitalize text-rb-text-secondary font-medium">
                      {BRANCH_LABELS[barber.branch] ?? barber.branch ?? '—'}
                    </div>
                    <div>
                      <span
                        className={`inline-block rounded-rb-pill px-2.5 py-1 text-[11px] font-semibold ${statusBadgeTint(
                          barber.attendance_status
                        )}`}
                      >
                        {attendanceLabel(barber.attendance_status)}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-rb-text">
                      {barber.today_count} layanan
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Regular Employee Attendance Section - Honest Unavailable State */}
          <div className="rounded-rb-card border border-rb-border bg-rb-surface p-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-serif text-base font-semibold text-rb-text">
                Absensi Karyawan Reguler (Fingerprint)
              </h2>
              <div className="flex items-center gap-2">
                <Link
                  to="/attendance/import"
                  className="text-xs font-semibold text-rb-red hover:underline"
                >
                  Import Fingerprint →
                </Link>
                <span className="rounded-rb-pill bg-rb-divider px-2.5 py-0.5 text-[11px] font-semibold text-rb-text-muted">
                  Belum terhubung
                </span>
              </div>
            </div>
            <EmptyState
              title="Data fingerprint karyawan reguler belum terhubung"
              description="Integrasi mesin absensi fingerprint cabang dan kantor pusat sedang dalam tahap perancangan format data. Backoffice tidak menampilkan estimasi atau simulasi absensi tanpa integrasi langsung."
            />
          </div>
        </>
      )}
    </>
  );
}
