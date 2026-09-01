import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { getCustomerSegments, type CustomerSegmentsResult } from '../services/crm';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CustomerSegmentsResult };

export function CustomerReport() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    getCustomerSegments({ limit: 50 })
      .then((data) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'error', message: 'Terjadi kesalahan memuat customer report.' }));
  }, []);

  return (
    <>
      <Link to="/reports" className="mb-2.5 inline-block text-sm font-semibold text-rb-text-muted">← Reports</Link>
      <PageHeader title="Customer Report" />

      {state.status === 'loading' && <LoadingState label="Memuat customer report..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard value={state.data.kpis.active_customers} label="Active Customers" tint="blue" />
            <StatCard value={state.data.kpis.new_customers} label="New Customers" tint="green" />
            <StatCard value={state.data.kpis.repeat_customers} label="Repeat Customers" tint="red" />
            <StatCard value={state.data.kpis.dormant_customers} label="Dormant Customers" tint="orange" />
            <StatCard value={state.data.kpis.avg_visit_interval_days !== null ? `${state.data.kpis.avg_visit_interval_days} hari` : '—'} label="Avg Visit Interval" tint="purple" />
          </section>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
              <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Favorite Barber</h2>
              <div className="flex flex-col divide-y divide-rb-divider">
                {state.data.favorite_barbers.map((b) => (
                  <div key={b.name} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium text-rb-text">{b.name}</span>
                    <span className="font-semibold text-rb-text-muted">{b.count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
              <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Favorite Service</h2>
              <div className="flex flex-col divide-y divide-rb-divider">
                {state.data.favorite_services.map((s) => (
                  <div key={s.service_name} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium text-rb-text">{s.service_name}</span>
                    <span className="font-semibold text-rb-text-muted">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
            <div className="border-b border-rb-divider px-4 py-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
              Detail Pelanggan
            </div>
            <div className="grid grid-cols-5 gap-2 border-b border-rb-divider px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
              <div>Nama</div><div>Last Visit</div><div>Cabang Favorit</div><div>Barber Favorit</div><div>Total Visit</div>
            </div>
            <div className="flex flex-col divide-y divide-rb-divider">
              {state.data.customers.items.map((c) => (
                <div key={c.customer_key} className="grid grid-cols-5 items-center gap-2 px-4 py-3 text-sm">
                  <div className="font-semibold text-rb-text">
                    <Link to={`/crm/customers/${encodeURIComponent(c.customer_key)}`}>{c.name}</Link>
                  </div>
                  <div className="text-rb-text-secondary">{c.last_visit}</div>
                  <div className="text-rb-text-secondary">{c.favorite_branch ?? '—'}</div>
                  <div className="text-rb-text-secondary">{c.favorite_barber ?? '—'}</div>
                  <div className="text-rb-text-secondary">{c.total_visits}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
