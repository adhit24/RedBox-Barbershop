import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { getBarberPerformance, type BarberPerformanceEntry } from '../services/crm';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; barbers: BarberPerformanceEntry[] };

const BRANCH_ORDER = ['bypass', 'csb', 'samadikun', 'sumber', 'tegal'];

function branchRank(branch: string | null) {
  const index = BRANCH_ORDER.indexOf((branch ?? '').toLowerCase());
  return index === -1 ? BRANCH_ORDER.length : index;
}

export function BarberPerformance() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    getBarberPerformance({})
      .then((data) => setState({ status: 'ready', barbers: data.barbers }))
      .catch(() => setState({ status: 'error', message: 'Terjadi kesalahan memuat barber performance.' }));
  }, []);

  const sortedBarbers = useMemo(() => {
    if (state.status !== 'ready') return [];
    return [...state.barbers].sort((a, b) => {
      const branchDiff = branchRank(a.branch) - branchRank(b.branch);
      if (branchDiff !== 0) return branchDiff;
      return a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });
    });
  }, [state]);

  return (
    <>
      <Link to="/reports" className="mb-2.5 inline-block text-sm font-semibold text-rb-text-muted">← Reports</Link>
      <PageHeader title="Barber Performance" />

      {state.status === 'loading' && <LoadingState label="Memuat barber performance..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <div className="overflow-hidden rounded-rb-card border border-rb-border bg-rb-surface">
          <div className="border-b border-rb-divider px-4 py-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
            Performa Kapster per Cabang
          </div>
          <div className="grid grid-cols-4 gap-2 border-b border-rb-divider px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
            <div>Barber</div><div>Cabang</div><div>Customer</div><div>Repeat</div>
          </div>
          <div className="flex flex-col divide-y divide-rb-divider">
            {sortedBarbers.map((b) => (
              <div key={b.barber_id} className="grid grid-cols-4 items-center gap-2 px-4 py-3 text-sm">
                <div data-testid="barber-name" className="font-semibold text-rb-text">{b.name}</div>
                <div className="capitalize text-rb-text-secondary">{b.branch ?? '—'}</div>
                <div className="text-rb-text-secondary">{b.customers_served}</div>
                <div className="text-rb-text-secondary">{b.repeat_rate}%</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
