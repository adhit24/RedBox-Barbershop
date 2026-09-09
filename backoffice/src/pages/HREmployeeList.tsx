import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { getHRPeople, type HRPeopleResponse, type WorkforceFilter } from '../services/hr';

const FILTERS: { value: WorkforceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'redbox', label: 'Redbox' },
  { value: 'sundaze', label: 'Sundaze' },
];

const BRANCH_LABELS: Record<string, string> = {
  bypass: 'Bypass', csb: 'CSB', samadikun: 'Samadikun', sumber: 'Sumber', tegal: 'Tegal',
};

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: HRPeopleResponse };

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || 'RB';
}

export function HREmployeeList() {
  const [filter, setFilter] = useState<WorkforceFilter>('all');
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    getHRPeople(filter)
      .then(data => { if (!cancelled) setState({ status: 'ready', data }); })
      .catch(() => { if (!cancelled) setState({ status: 'error', message: 'Data HR & People belum dapat dimuat dari database.' }); });
    return () => { cancelled = true; };
  }, [filter]);

  return (
    <>
      <PageHeader
        title="HR & People"
        subtitle="Directory tenaga kerja aktif dari database production Redbox dan Sundaze."
        actions={<span className="rounded-rb-pill bg-rb-green-tint-bg px-3 py-1.5 text-[11px] font-semibold text-rb-green-tint-fg">LIVE DATABASE</span>}
      />

      <div className="mb-5 flex flex-wrap gap-2" aria-label="Filter unit bisnis">
        {FILTERS.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            className={`rounded-rb-pill px-4 py-2 text-sm font-semibold ${filter === option.value ? 'bg-rb-red text-white' : 'border border-rb-border bg-rb-surface text-rb-text-secondary'}`}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {state.status === 'loading' && <LoadingState label="Memuat tenaga kerja aktif..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard value={state.data.kpis.active_barbers} label="Kapster Aktif" tint="red" />
            <StatCard value={state.data.kpis.regular_employees} label="Karyawan Reguler" tint="purple" />
            <StatCard value={state.data.kpis.barber_branches} label="Cabang dengan Kapster" tint="orange" />
            <StatCard value={state.data.kpis.active_business_units} label="Unit Bisnis Live" tint="teal" />
          </section>

          {filter !== 'sundaze' && (
            <div className="mb-4 rounded-rb-card border border-rb-orange-tint-fg/25 bg-rb-orange-tint-bg px-4 py-3 text-sm text-rb-text-secondary" data-testid="barber-reconciliation-note">
              Database saat ini mencatat {state.data.kpis.active_barbers} kapster aktif. Owner memperkirakan 27; satu record menunggu rekonsiliasi dan tidak diubah dalam PR ini.
            </div>
          )}

          <div className="overflow-x-auto rounded-rb-card border border-rb-border bg-rb-surface">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-rb-divider text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
                <tr>
                  <th className="px-4 py-3">Karyawan</th><th className="px-4 py-3">Unit Bisnis</th><th className="px-4 py-3">Posisi</th>
                  <th className="px-4 py-3">Cabang</th><th className="px-4 py-3">Tipe Kerja</th><th className="px-4 py-3">Attendance</th><th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rb-divider">
                {state.data.people.map(person => (
                  <tr key={person.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rb-red-tint-bg text-xs font-semibold text-rb-red-tint-fg">{initials(person.name)}</span>
                        <div><div className="font-semibold text-rb-text">{person.name}</div>{person.nickname && person.nickname !== person.name && <div className="text-[11px] text-rb-text-faint">{person.nickname}</div>}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-rb-text-secondary">{person.business_unit}</td>
                    <td className="px-4 py-3 text-rb-text-secondary">{person.position}</td>
                    <td className="px-4 py-3 text-rb-text-secondary">{BRANCH_LABELS[person.branch || ''] ?? person.branch_name ?? person.branch ?? '—'}</td>
                    <td className="px-4 py-3 text-rb-text-secondary">{person.employment_type}</td>
                    <td className="px-4 py-3 font-semibold text-rb-text-secondary">Belum tersedia</td>
                    <td className="px-4 py-3"><span className="rounded-rb-pill bg-rb-green-tint-bg px-2.5 py-1 text-[11px] font-semibold text-rb-green-tint-fg">Aktif</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
