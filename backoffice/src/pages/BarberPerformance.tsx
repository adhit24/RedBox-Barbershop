import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { getBarberPerformance, type BarberPerformanceEntry } from '../services/crm';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; barbers: BarberPerformanceEntry[] };

export function BarberPerformance() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    getBarberPerformance({})
      .then((data) => setState({ status: 'ready', barbers: data.barbers }))
      .catch(() => setState({ status: 'error', message: 'Terjadi kesalahan memuat barber performance.' }));
  }, []);

  return (
    <>
      <Link to="/reports" className="mb-2.5 inline-block text-sm font-semibold text-rb-text-muted">← Reports</Link>
      <PageHeader title="Barber Performance" />

      {state.status === 'loading' && <LoadingState label="Memuat barber performance..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
          <div className="border-b border-rb-divider px-4 py-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
            Leaderboard Barber
          </div>
          <div className="grid grid-cols-5 gap-2 border-b border-rb-divider px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
            <div>Barber</div><div>Cabang</div><div>Customer</div><div>Repeat</div><div>Layanan Selesai</div>
          </div>
          <div className="flex flex-col divide-y divide-rb-divider">
            {state.barbers.map((b) => (
              <div key={b.barber_id} className="grid grid-cols-5 items-center gap-2 px-4 py-3 text-sm">
                <div className="font-semibold text-rb-text">{b.name}</div>
                <div className="text-rb-text-secondary">{b.branch ?? '—'}</div>
                <div className="text-rb-text-secondary">{b.customers_served}</div>
                <div className="text-rb-text-secondary">{b.repeat_rate}%</div>
                <div className="text-rb-text-secondary">{b.completed_services}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
