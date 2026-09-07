import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { getEmployees, type RegularEmployee } from '../services/crm';

const BRANCH_LABELS: Record<string, string> = {
  bypass: 'Bypass',
  csb: 'CSB',
  samadikun: 'Samadikun',
  sumber: 'Sumber',
  tegal: 'Tegal',
};

type FilterUnit = 'all' | 'Redbox' | 'Sundaze';

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; employees: RegularEmployee[] };

export function RegularPayroll() {
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [unitFilter, setUnitFilter] = useState<FilterUnit>('all');

  useEffect(() => {
    getEmployees()
      .then((res) => {
        if (res.ok && res.employees) {
          setState({ status: 'ready', employees: res.employees });
        } else {
          setState({ status: 'error', message: 'Gagal memuat daftar karyawan reguler.' });
        }
      })
      .catch((err) => {
        setState({
          status: 'error',
          message: err?.message || 'Terjadi kesalahan saat memuat data karyawan reguler.',
        });
      });
  }, []);

  const filteredEmployees = useMemo(() => {
    if (state.status !== 'ready') return [];
    return state.employees.filter((emp) => {
      if (!emp.is_active) return false;
      if (unitFilter !== 'all' && emp.business_unit !== unitFilter) return false;
      return true;
    });
  }, [state, unitFilter]);

  const sundazeCount = useMemo(() => {
    if (state.status !== 'ready') return 0;
    return state.employees.filter((e) => e.business_unit === 'Sundaze' && e.is_active).length;
  }, [state]);

  const redboxCount = useMemo(() => {
    if (state.status !== 'ready') return 0;
    return state.employees.filter((e) => e.business_unit === 'Redbox' && e.is_active).length;
  }, [state]);

  return (
    <>
      <Link to="/payroll" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted hover:text-rb-text">
        ← Kembali ke Payroll
      </Link>
      <PageHeader
        title="Regular Payroll"
        subtitle="Daftar karyawan reguler Redbox & Sundaze berbasis gaji. Formula komisi dan kalkulasi otomatis dalam tahap validasi."
      />

      {state.status === 'loading' && (
        <LoadingState label="Memuat data karyawan reguler dari database..." />
      )}

      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              value={state.employees.length}
              label={`Total Karyawan (${sundazeCount} SD · ${redboxCount} RB)`}
              tint="blue"
            />
            <StatCard
              value="—"
              label="Komisi Kasir / Produk"
              trend="Formula belum tervalidasi"
              tint="yellow"
            />
            <StatCard
              value="—"
              label="Penyesuaian Absensi"
              trend="Belum terhubung"
              tint="purple"
            />
            <StatCard
              value="—"
              label="Status Payroll Periode Ini"
              trend="Belum tersedia"
              tint="green"
            />
          </section>

          {/* Filter Bar */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setUnitFilter('all')}
              className={`rounded-rb-pill px-3 py-1.5 text-xs font-semibold transition ${
                unitFilter === 'all'
                  ? 'bg-rb-red text-white'
                  : 'bg-rb-surface text-rb-text-secondary border border-rb-border hover:bg-rb-surface-hover'
              }`}
            >
              Semua ({state.employees.length})
            </button>
            <button
              type="button"
              onClick={() => setUnitFilter('Sundaze')}
              className={`rounded-rb-pill px-3 py-1.5 text-xs font-semibold transition ${
                unitFilter === 'Sundaze'
                  ? 'bg-rb-red text-white'
                  : 'bg-rb-surface text-rb-text-secondary border border-rb-border hover:bg-rb-surface-hover'
              }`}
            >
              Sundaze ({sundazeCount})
            </button>
            <button
              type="button"
              onClick={() => setUnitFilter('Redbox')}
              className={`rounded-rb-pill px-3 py-1.5 text-xs font-semibold transition ${
                unitFilter === 'Redbox'
                  ? 'bg-rb-red text-white'
                  : 'bg-rb-surface text-rb-text-secondary border border-rb-border hover:bg-rb-surface-hover'
              }`}
            >
              Redbox ({redboxCount})
            </button>
          </div>

          <div className="overflow-hidden rounded-rb-card border border-rb-border bg-rb-surface">
            <div className="grid grid-cols-[1.4fr_1fr_1fr_0.9fr_1fr_1.1fr_0.7fr] gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
              <div>Karyawan</div>
              <div>Unit Bisnis</div>
              <div>Posisi</div>
              <div>Cabang</div>
              <div>Tipe Payroll</div>
              <div>Rincian Payroll</div>
              <div>Status</div>
            </div>
            <div className="flex flex-col divide-y divide-rb-divider">
              {filteredEmployees.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-rb-text-muted">
                  Tidak ada karyawan yang cocok dengan filter yang dipilih.
                </div>
              ) : (
                filteredEmployees.map((emp) => (
                  <div
                    key={emp.id}
                    className="grid grid-cols-[1.4fr_1fr_1fr_0.9fr_1fr_1.1fr_0.7fr] items-center gap-2 px-4 py-3 text-sm"
                  >
                    <div>
                      <Link
                        to={`/payroll/employees/emp-${emp.id}`}
                        className="font-semibold capitalize text-rb-text hover:text-rb-red hover:underline"
                      >
                        {emp.name}
                      </Link>
                      <div className="text-[11px] font-mono text-rb-text-faint">
                        {emp.employee_code || emp.id.slice(0, 8)}
                      </div>
                    </div>
                    <div>
                      <span
                        className={`inline-block rounded-rb-pill px-2.5 py-0.5 text-[11px] font-semibold ${
                          emp.business_unit === 'Sundaze'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            : 'bg-rb-red-tint-bg text-rb-red-tint-fg'
                        }`}
                      >
                        {emp.business_unit === 'Sundaze' ? 'Sundaze Cafe' : 'Redbox Barbershop'}
                      </span>
                    </div>
                    <div className="text-rb-text-secondary font-medium">
                      {emp.position}
                    </div>
                    <div className="capitalize text-rb-text-secondary">
                      {emp.branch ? (BRANCH_LABELS[emp.branch.toLowerCase()] ?? emp.branch) : '—'}
                    </div>
                    <div className="text-xs text-rb-text-secondary font-medium">
                      Gaji
                    </div>
                    <div>
                      <span className="text-xs text-rb-text-muted italic">
                        Formula belum tervalidasi
                      </span>
                    </div>
                    <div>
                      <span className="rounded-rb-pill bg-rb-green-tint-bg px-2.5 py-1 text-[11px] font-semibold text-rb-green-tint-fg">
                        Aktif
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-4 text-xs text-rb-text-muted">
            Menampilkan {filteredEmployees.length} karyawan reguler aktif dari Supabase. Gaji pokok dan komisi tidak diekspos pada daftar publik demi privasi data dan kepatuhan RLS.
          </div>
        </>
      )}
    </>
  );
}
