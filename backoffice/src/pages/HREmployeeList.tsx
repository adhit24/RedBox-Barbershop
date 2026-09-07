import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import {
  getCommandCenterForBranch,
  getEmployees,
  type CommandCenterBarber,
  type RegularEmployee,
} from '../services/crm';

const BRANCHES = ['bypass', 'csb', 'samadikun', 'sumber', 'tegal'] as const;
const BRANCH_LABELS: Record<string, string> = {
  bypass: 'Bypass',
  csb: 'CSB',
  samadikun: 'Samadikun',
  sumber: 'Sumber',
  tegal: 'Tegal',
};

type FilterCategory = 'all' | 'kapster' | 'sundaze' | 'redbox_reguler';

interface UnifiedPersonnel {
  id: string;
  code: string;
  name: string;
  business_unit: string;
  business_unit_badge: 'redbox' | 'sundaze';
  position: string;
  branch: string;
  payroll_type: 'Bagi Hasil' | 'Gaji';
  attendance_status: string | null;
  category: 'kapster' | 'sundaze' | 'redbox_reguler';
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      barbers: CommandCenterBarber[];
      employees: RegularEmployee[];
      failedBranches: string[];
    };

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'RB'
  );
}

function attendanceLabel(status: string | null) {
  if (!status) return 'Belum tersedia';
  const normalized = status.trim().toLowerCase();
  if (normalized === 'hadir') return 'Hadir';
  if (normalized === 'tidak_hadir') return 'Tidak hadir';
  if (normalized === 'belum_check_in') return 'Belum check-in';
  return status.replaceAll('_', ' ');
}

export function HREmployeeList() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('all');
  const [selectedBranch, setSelectedBranch] = useState<string>('all');

  useEffect(() => {
    Promise.allSettled([
      ...BRANCHES.map((branch) => getCommandCenterForBranch(branch)),
      getEmployees(),
    ]).then((results) => {
      const failedBranches: string[] = [];
      const barberMap = new Map<string, CommandCenterBarber>();

      // First 5 results are branch command center calls
      for (let i = 0; i < BRANCHES.length; i++) {
        const res = results[i];
        const requestedBranch = BRANCHES[i];
        if (res.status === 'rejected') {
          failedBranches.push(requestedBranch);
        } else {
          const val = res.value as { barbers?: CommandCenterBarber[] };
          for (const barber of val?.barbers ?? []) {
            if (!barberMap.has(barber.id)) barberMap.set(barber.id, barber);
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

      // Last result is employees call
      let employees: RegularEmployee[] = [];
      const empResult = results[BRANCHES.length];
      if (empResult && empResult.status === 'fulfilled') {
        const val = empResult.value as { employees?: RegularEmployee[] };
        employees = val?.employees ?? [];
      }

      if (barbers.length === 0 && failedBranches.length === BRANCHES.length && employees.length === 0) {
        setState({
          status: 'error',
          message: 'Data HR & People belum dapat dimuat dari database.',
        });
        return;
      }

      setState({ status: 'ready', barbers, employees, failedBranches });
    });
  }, []);

  const branchCount = useMemo(() => {
    if (state.status !== 'ready') return 0;
    return new Set(state.barbers.map((b) => b.branch).filter(Boolean)).size;
  }, [state]);

  const liveBusinessUnits = useMemo(() => {
    if (state.status !== 'ready') return 0;
    const units = new Set<string>();
    if (state.barbers.length > 0) units.add('Redbox');
    for (const emp of state.employees) {
      if (emp.is_active && emp.business_unit) units.add(emp.business_unit);
    }
    return units.size;
  }, [state]);

  const sundazeCount = useMemo(() => {
    if (state.status !== 'ready') return 0;
    return state.employees.filter((e) => e.business_unit === 'Sundaze' && e.is_active).length;
  }, [state]);

  const redboxRegulerCount = useMemo(() => {
    if (state.status !== 'ready') return 0;
    return state.employees.filter((e) => e.business_unit === 'Redbox' && e.is_active).length;
  }, [state]);

  const unifiedList = useMemo<UnifiedPersonnel[]>(() => {
    if (state.status !== 'ready') return [];

    const list: UnifiedPersonnel[] = [];

    // Add barbers
    for (const b of state.barbers) {
      list.push({
        id: `barber-${b.id}`,
        code: b.id,
        name: b.name,
        business_unit: 'Redbox Barbershop',
        business_unit_badge: 'redbox',
        position: 'Kapster',
        branch: b.branch,
        payroll_type: 'Bagi Hasil',
        attendance_status: b.attendance_status,
        category: 'kapster',
      });
    }

    // Add regular employees
    for (const e of state.employees) {
      if (!e.is_active) continue;
      const isSundaze = e.business_unit === 'Sundaze';
      list.push({
        id: `emp-${e.id}`,
        code: e.employee_code || e.id.slice(0, 8),
        name: e.name,
        business_unit: isSundaze ? 'Sundaze Cafe' : 'Redbox Barbershop',
        business_unit_badge: isSundaze ? 'sundaze' : 'redbox',
        position: e.position,
        branch: e.branch || 'bypass',
        payroll_type: 'Gaji',
        attendance_status: null,
        category: isSundaze ? 'sundaze' : 'redbox_reguler',
      });
    }

    // Sort: Business Unit (Redbox first, Sundaze second), then Branch, then Name
    return list.sort((a, b) => {
      if (a.business_unit !== b.business_unit) {
        return a.business_unit.localeCompare(b.business_unit);
      }
      if (a.branch !== b.branch) {
        return (BRANCHES.indexOf(a.branch as (typeof BRANCHES)[number]) -
          BRANCHES.indexOf(b.branch as (typeof BRANCHES)[number]));
      }
      return a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });
    });
  }, [state]);

  const filteredList = useMemo(() => {
    return unifiedList.filter((item) => {
      if (activeFilter !== 'all' && item.category !== activeFilter) {
        return false;
      }
      if (selectedBranch !== 'all' && item.branch !== selectedBranch) {
        return false;
      }
      return true;
    });
  }, [unifiedList, activeFilter, selectedBranch]);

  return (
    <>
      <PageHeader
        title="HR & People"
        subtitle="Roster aktif Redbox Barbershop & Sundaze Cafe dari database Supabase (Kapster bagi hasil & Karyawan reguler gaji)."
        actions={
          <span className="rounded-rb-pill bg-rb-green-tint-bg px-3 py-1.5 text-[11px] font-semibold text-rb-green-tint-fg">
            LIVE
          </span>
        }
      />

      {state.status === 'loading' && (
        <LoadingState label="Memuat data roster kapster & karyawan reguler dari database..." />
      )}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          {state.failedBranches.length > 0 && (
            <div className="mb-4 rounded-rb-card border border-rb-orange-tint-fg/20 bg-rb-orange-tint-bg px-4 py-3 text-sm text-rb-text-secondary">
              Data sebagian cabang belum berhasil dimuat:{' '}
              {state.failedBranches.map((b) => BRANCH_LABELS[b] ?? b).join(', ')}.
            </div>
          )}

          {/* KPI StatCards */}
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              value={state.barbers.length + state.employees.length}
              label="Total Karyawan Aktif"
              tint="blue"
            />
            <StatCard
              value={state.barbers.length}
              label="Kapster Aktif"
              tint="red"
            />
            <StatCard
              value={state.employees.length}
              label={`Karyawan Reguler (${sundazeCount} SD · ${redboxRegulerCount} RB)`}
              tint="purple"
            />
            <StatCard
              value={branchCount}
              label="Cabang dengan Kapster"
              tint="orange"
            />
            <StatCard
              value={liveBusinessUnits}
              label="Unit Bisnis Live"
              tint="teal"
            />
          </section>

          {/* Filter Bar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveFilter('all')}
                className={`rounded-rb-pill px-3 py-1.5 text-xs font-semibold transition ${
                  activeFilter === 'all'
                    ? 'bg-rb-red text-white'
                    : 'bg-rb-surface text-rb-text-secondary border border-rb-border hover:bg-rb-surface-hover'
                }`}
              >
                Semua ({unifiedList.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('kapster')}
                className={`rounded-rb-pill px-3 py-1.5 text-xs font-semibold transition ${
                  activeFilter === 'kapster'
                    ? 'bg-rb-red text-white'
                    : 'bg-rb-surface text-rb-text-secondary border border-rb-border hover:bg-rb-surface-hover'
                }`}
              >
                Kapster ({state.barbers.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('sundaze')}
                className={`rounded-rb-pill px-3 py-1.5 text-xs font-semibold transition ${
                  activeFilter === 'sundaze'
                    ? 'bg-rb-red text-white'
                    : 'bg-rb-surface text-rb-text-secondary border border-rb-border hover:bg-rb-surface-hover'
                }`}
              >
                Sundaze ({sundazeCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('redbox_reguler')}
                className={`rounded-rb-pill px-3 py-1.5 text-xs font-semibold transition ${
                  activeFilter === 'redbox_reguler'
                    ? 'bg-rb-red text-white'
                    : 'bg-rb-surface text-rb-text-secondary border border-rb-border hover:bg-rb-surface-hover'
                }`}
              >
                Redbox Reguler ({redboxRegulerCount})
              </button>
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
                <option value="all">Semua Cabang</option>
                {BRANCHES.map((b) => (
                  <option key={b} value={b}>
                    {BRANCH_LABELS[b]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Roster Table */}
          <div className="overflow-hidden rounded-rb-card border border-rb-border bg-rb-surface">
            <div className="grid grid-cols-[1.4fr_1.1fr_1fr_0.8fr_1fr_1fr_0.7fr] gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
              <div>Karyawan</div>
              <div>Unit Bisnis</div>
              <div>Posisi</div>
              <div>Cabang</div>
              <div>Tipe Payroll</div>
              <div>Attendance</div>
              <div>Status</div>
            </div>
            <div className="flex flex-col divide-y divide-rb-divider">
              {filteredList.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-rb-text-muted">
                  Tidak ada data karyawan yang cocok dengan filter yang dipilih.
                </div>
              ) : (
                filteredList.map((person) => (
                  <div
                    key={person.id}
                    className="grid grid-cols-[1.4fr_1.1fr_1fr_0.8fr_1fr_1fr_0.7fr] items-center gap-2 px-4 py-3 text-sm"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                          person.business_unit_badge === 'sundaze'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            : 'bg-rb-red-tint-bg text-rb-red-tint-fg'
                        }`}
                      >
                        {initials(person.name)}
                      </span>
                      <div>
                        <Link
                          to={`/hr/employees/${person.id}`}
                          className="font-semibold capitalize text-rb-text hover:text-rb-red hover:underline"
                        >
                          {person.name}
                        </Link>
                        <div className="text-[11px] text-rb-text-faint font-mono">
                          {person.code}
                        </div>
                      </div>
                    </div>
                    <div>
                      <span
                        className={`inline-block rounded-rb-pill px-2.5 py-0.5 text-[11px] font-semibold ${
                          person.business_unit_badge === 'sundaze'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            : 'bg-rb-red-tint-bg text-rb-red-tint-fg'
                        }`}
                      >
                        {person.business_unit}
                      </span>
                    </div>
                    <div className="text-rb-text-secondary font-medium">
                      {person.position}
                    </div>
                    <div className="capitalize text-rb-text-secondary">
                      {BRANCH_LABELS[person.branch] ?? person.branch ?? '—'}
                    </div>
                    <div className="text-xs text-rb-text-secondary">
                      {person.payroll_type}
                    </div>
                    <div className="text-xs font-medium text-rb-text-secondary">
                      {attendanceLabel(person.attendance_status)}
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
            Data karyawan reguler ({state.employees.length}) dan kapster ({state.barbers.length}) terhubung langsung ke database Supabase. Total unit bisnis aktif: {liveBusinessUnits} (Redbox Barbershop &amp; Sundaze Cafe).
          </div>
        </>
      )}
    </>
  );
}
