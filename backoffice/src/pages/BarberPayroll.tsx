import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { getCommandCenterForBranch, type CommandCenterBarber } from '../services/crm';

const BRANCHES = ['bypass', 'csb', 'samadikun', 'sumber', 'tegal'] as const;
const BRANCH_LABELS: Record<string, string> = {
  bypass: 'Bypass',
  csb: 'CSB',
  samadikun: 'Samadikun',
  sumber: 'Sumber',
  tegal: 'Tegal',
};

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; barbers: CommandCenterBarber[] };

export function BarberPayroll() {
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [selectedBranch, setSelectedBranch] = useState<string>('all');

  useEffect(() => {
    Promise.allSettled(BRANCHES.map((b) => getCommandCenterForBranch(b))).then(
      (results) => {
        const barberMap = new Map<string, CommandCenterBarber>();
        for (const res of results) {
          if (res.status === 'fulfilled' && res.value?.barbers) {
            for (const barber of res.value.barbers) {
              if (!barberMap.has(barber.id)) {
                barberMap.set(barber.id, barber);
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
            message: 'Data kapster belum dapat dimuat dari cabang.',
          });
          return;
        }

        setState({ status: 'ready', barbers });
      }
    );
  }, []);

  const filteredBarbers = useMemo(() => {
    if (state.status !== 'ready') return [];
    if (selectedBranch === 'all') return state.barbers;
    return state.barbers.filter((b) => b.branch === selectedBranch);
  }, [state, selectedBranch]);

  const branchCount = useMemo(() => {
    if (state.status !== 'ready') return 0;
    return new Set(state.barbers.map((b) => b.branch).filter(Boolean)).size;
  }, [state]);

  return (
    <>
      <Link to="/payroll" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted hover:text-rb-text">
        ← Kembali ke Payroll
      </Link>
      <PageHeader
        title="Barber Payroll"
        subtitle="Daftar kapster aktif Redbox Barbershop berbasis skema bagi hasil. Persentase dan rincian komisi tidak di-hardcode."
      />

      {state.status === 'loading' && (
        <LoadingState label="Memuat data kapster dari seluruh cabang..." />
      )}

      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              value={state.barbers.length}
              label="Total Kapster Aktif"
              tint="red"
            />
            <StatCard
              value={branchCount}
              label="Cabang Operasional"
              tint="blue"
            />
            <StatCard
              value="—"
              label="Skema Revenue Sharing"
              trend="Formula belum tervalidasi"
              tint="yellow"
            />
            <StatCard
              value="—"
              label="Kalkulasi Komisi Bulanan"
              trend="Belum tersedia"
              tint="green"
            />
          </section>

          {/* Filter Bar */}
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="branch-select" className="text-xs text-rb-text-muted">
                Filter Cabang:
              </label>
              <select
                id="branch-select"
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

          <div className="overflow-hidden rounded-rb-card border border-rb-border bg-rb-surface">
            <div className="grid grid-cols-[1.5fr_1fr_1fr_1.4fr_0.8fr] gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
              <div>Kapster</div>
              <div>Cabang</div>
              <div>Tipe Payroll</div>
              <div>Rincian Payroll</div>
              <div>Status</div>
            </div>
            <div className="flex flex-col divide-y divide-rb-divider">
              {filteredBarbers.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-rb-text-muted">
                  Tidak ada kapster pada cabang yang dipilih.
                </div>
              ) : (
                filteredBarbers.map((barber) => (
                  <div
                    key={barber.id}
                    className="grid grid-cols-[1.5fr_1fr_1fr_1.4fr_0.8fr] items-center gap-2 px-4 py-3 text-sm"
                  >
                    <div>
                      <Link
                        to={`/payroll/employees/barber-${barber.id}`}
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
                    <div className="text-xs text-rb-text-secondary font-medium">
                      Bagi Hasil
                    </div>
                    <div>
                      <span className="text-xs text-rb-text-muted italic">
                        Formula bagi hasil belum tervalidasi
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
            Menampilkan {filteredBarbers.length} kapster aktif. Pembagian revenue sharing dan komisi produk mengikuti regulasi internal manajemen dan tidak dihitung secara artifisial.
          </div>
        </>
      )}
    </>
  );
}
