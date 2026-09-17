import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import {
  getAttendanceOverview,
  type AttendanceOverviewResponse,
} from '../services/crm';

const BRANCHES = ['bypass', 'csb', 'samadikun', 'sumber', 'tegal'] as const;
const BRANCH_LABELS: Record<string, string> = {
  bypass: 'Bypass',
  csb: 'CSB',
  samadikun: 'Samadikun',
  sumber: 'Sumber',
  tegal: 'Tegal',
  pusat: 'Pusat',
};

function attendanceLabel(status: string | null) {
  if (!status) return 'Belum tersedia';
  const normalized = status.trim().toLowerCase();
  if (normalized === 'hadir') return 'Hadir';
  if (normalized === 'tidak_hadir' || normalized === 'absent') return 'Tidak Hadir';
  if (normalized === 'terlambat') return 'Terlambat';
  if (normalized === 'belum_check_in') return 'Belum Check-in';
  if (normalized === 'izin') return 'Izin';
  if (normalized === 'sakit') return 'Sakit';
  if (normalized === 'cuti') return 'Cuti';
  if (normalized === 'off') return 'Libur (Off)';
  return status.replaceAll('_', ' ');
}

function statusBadgeTint(status: string | null) {
  if (!status) return 'bg-rb-divider text-rb-text-muted';
  const normalized = status.trim().toLowerCase();
  if (normalized === 'hadir') return 'bg-rb-green-tint-bg text-rb-green-tint-fg';
  if (normalized === 'terlambat') return 'bg-rb-orange-tint-bg text-rb-orange-tint-fg';
  if (['tidak_hadir', 'absent'].includes(normalized)) return 'bg-rb-red-tint-bg text-rb-red-tint-fg';
  if (['izin', 'sakit', 'cuti'].includes(normalized)) return 'bg-rb-blue-tint-bg text-rb-blue-tint-fg';
  if (normalized === 'belum_check_in') return 'bg-rb-divider text-rb-text-muted';
  return 'bg-rb-divider text-rb-text-muted';
}

export function AttendanceOverview() {
  // Default to sample imported date where real data exists (2026-08-05) or allow today
  const [selectedDate, setSelectedDate] = useState<string>('2026-08-05');
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [selectedPersonType, setSelectedPersonType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const [data, setData] = useState<AttendanceOverviewResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchOverview = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await getAttendanceOverview({
        date: selectedDate,
        branch: selectedBranch,
        person_type: selectedPersonType,
        status: selectedStatus,
      });
      if (res.ok) {
        setData(res);
      } else {
        setErrorMsg('Gagal memuat ringkasan presensi');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat data presensi dari server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, [selectedDate, selectedBranch, selectedPersonType, selectedStatus]);

  const stats = data?.stats || {
    total_workforce: 0,
    hadir: 0,
    terlambat: 0,
    belum_check_in: 0,
    tidak_hadir: 0,
    missing_clock_in: 0,
    missing_clock_out: 0,
    exceptions_count: 0,
  };

  const records = data?.records || [];

  return (
    <>
      <PageHeader
        title="Attendance Command Center"
        subtitle="Monitoring kehadiran terpadu Redbox (Karyawan Reguler & Kapster) dari data fingerprint mesin dan terminal cabang."
      />

      {/* Control Bar: Date, Branch, Person Type, Status */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-rb-card border border-rb-border bg-rb-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="att-date" className="text-xs font-semibold text-rb-text-muted">
              Tanggal:
            </label>
            <input
              id="att-date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs font-semibold text-rb-text"
            />
          </div>

          <button
            type="button"
            onClick={() => setSelectedDate('2026-08-05')}
            className={`rounded-rb-button px-2.5 py-1 text-xs font-medium transition ${
              selectedDate === '2026-08-05'
                ? 'bg-rb-red text-white'
                : 'border border-rb-border bg-rb-surface text-rb-text-secondary hover:bg-rb-surface-hover'
            }`}
          >
            Sample Import (05 Ags)
          </button>

          <button
            type="button"
            onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
            className={`rounded-rb-button px-2.5 py-1 text-xs font-medium transition ${
              selectedDate === new Date().toISOString().split('T')[0]
                ? 'bg-rb-red text-white'
                : 'border border-rb-border bg-rb-surface text-rb-text-secondary hover:bg-rb-surface-hover'
            }`}
          >
            Hari Ini
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Branch Filter */}
          <div className="flex items-center gap-2">
            <label htmlFor="branch-filter" className="text-xs font-semibold text-rb-text-muted">
              Cabang:
            </label>
            <select
              id="branch-filter"
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs font-semibold text-rb-text"
            >
              <option value="all">Semua Cabang Redbox</option>
              {BRANCHES.map((b) => (
                <option key={b} value={b}>
                  {BRANCH_LABELS[b]}
                </option>
              ))}
            </select>
          </div>

          {/* Person Type Filter */}
          <div className="flex items-center gap-2">
            <label htmlFor="person-type-filter" className="text-xs font-semibold text-rb-text-muted">
              Tipe:
            </label>
            <select
              id="person-type-filter"
              value={selectedPersonType}
              onChange={(e) => setSelectedPersonType(e.target.value)}
              className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs font-semibold text-rb-text"
            >
              <option value="all">Semua Person</option>
              <option value="employee">Karyawan Reguler</option>
              <option value="barber">Kapster</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <label htmlFor="status-filter" className="text-xs font-semibold text-rb-text-muted">
              Status:
            </label>
            <select
              id="status-filter"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs font-semibold text-rb-text"
            >
              <option value="all">Semua Status</option>
              <option value="hadir">Hadir (Tepat Waktu & Terlambat)</option>
              <option value="terlambat">Terlambat</option>
              <option value="belum_check_in">Belum Check-In</option>
              <option value="tidak_hadir">Tidak Hadir (Absent / Izin)</option>
              <option value="missing_punch">Missing Punch (Single Punch)</option>
            </select>
          </div>
        </div>
      </div>

      {loading && <LoadingState label="Memuat ringkasan presensi Redbox..." />}
      {errorMsg && <ErrorState message={errorMsg} />}

      {!loading && !errorMsg && (
        <>
          {/* KPI Stat Cards */}
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              value={stats.hadir}
              label={`Hadir (${stats.total_workforce} Total)`}
              trend={`${stats.terlambat} terlambat`}
              tint="green"
            />
            <StatCard
              value={stats.terlambat}
              label="Terlambat Masuk"
              trend="Berdasarkan jam shift"
              tint="orange"
            />
            <StatCard
              value={stats.belum_check_in + stats.tidak_hadir}
              label="Belum / Tidak Hadir"
              trend={`${stats.belum_check_in} belum, ${stats.tidak_hadir} absen`}
              tint="yellow"
            />
            <Link to="/attendance/exceptions" className="block no-underline">
              <StatCard
                value={stats.exceptions_count + stats.missing_clock_out}
                label="Exception / Anomali →"
                trend={`${stats.exceptions_count} unresolved, ${stats.missing_clock_out} missing out`}
                tint={stats.exceptions_count > 0 ? 'red' : 'blue'}
              />
            </Link>
          </section>

          {/* Attendance Roster Table */}
          <div className="mb-6 overflow-hidden rounded-rb-card border border-rb-border bg-rb-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rb-divider px-4 py-3">
              <div>
                <h2 className="font-serif text-base font-semibold text-rb-text">
                  Daftar Kehadiran Person ({records.length})
                </h2>
                <div className="text-xs text-rb-text-muted">
                  Tanggal {selectedDate} · Cabang: {selectedBranch === 'all' ? 'Seluruh Cabang' : BRANCH_LABELS[selectedBranch] || selectedBranch}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/attendance/import"
                  className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs font-semibold text-rb-text hover:bg-rb-surface-hover"
                >
                  Import Fingerprint
                </Link>
                <Link
                  to="/attendance/exceptions"
                  className="rounded-rb-button bg-rb-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-rb-red-hover"
                >
                  Review Exception ({stats.exceptions_count})
                </Link>
              </div>
            </div>

            {/* Table Header */}
            <div className="grid grid-cols-[1.8fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
              <div>Person / Nama</div>
              <div>Cabang</div>
              <div>Masuk</div>
              <div>Keluar</div>
              <div>Total Jam</div>
              <div>Keterlambatan</div>
              <div>Status Presensi</div>
            </div>

            {/* Table Rows */}
            <div className="flex flex-col divide-y divide-rb-divider">
              {records.length === 0 ? (
                <EmptyState
                  title="Tidak ada catatan presensi"
                  description="Tidak ditemukan data presensi untuk kriteria tanggal, cabang, atau filter yang dipilih."
                />
              ) : (
                records.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-[1.8fr_1fr_1fr_1fr_1fr_1fr_1fr] items-center gap-2 px-4 py-3 text-sm"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-rb-text">
                          {r.name}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                            r.person_type === 'barber'
                              ? 'bg-rb-brand-tint-bg text-rb-red'
                              : 'bg-rb-surface-hover text-rb-text-secondary'
                          }`}
                        >
                          {r.person_type === 'barber' ? 'Kapster' : 'Staff'}
                        </span>
                        {r.has_single_punch && (
                          <span className="rounded bg-rb-orange-tint-bg px-1.5 py-0.5 text-[10px] font-semibold text-rb-orange-tint-fg" title="Hanya 1 punch fingerprint tercatat">
                            Single Punch
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-rb-text-faint">
                        {r.position}
                      </div>
                    </div>

                    <div className="capitalize font-medium text-rb-text-secondary">
                      {BRANCH_LABELS[r.branch.toLowerCase()] || r.branch}
                    </div>

                    <div className="font-mono text-xs text-rb-text font-medium">
                      {r.first_check_in || '—'}
                    </div>

                    <div className="font-mono text-xs text-rb-text font-medium">
                      {r.last_check_out || '—'}
                    </div>

                    <div className="text-xs text-rb-text font-medium">
                      {r.total_hours || '—'}
                    </div>

                    <div className="text-xs text-rb-text-secondary">
                      {r.late_minutes > 0 ? (
                        <span className="font-semibold text-rb-orange-tint-fg">
                          +{r.late_minutes} mnt
                        </span>
                      ) : (
                        '—'
                      )}
                    </div>

                    <div>
                      <span
                        className={`inline-block rounded-rb-pill px-2.5 py-1 text-[11px] font-semibold ${statusBadgeTint(
                          r.status
                        )}`}
                      >
                        {attendanceLabel(r.status)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

