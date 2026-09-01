import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { LiveBadge } from '../components/LiveBadge';
import { getCustomerSegments, type CustomerSegmentsResult } from '../services/crm';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CustomerSegmentsResult };

const SEGMENT_COLORS: Record<string, string> = {
  loyal: 'bg-rb-blue-tint-fg',
  repeat: 'bg-rb-green-tint-fg',
  new: 'bg-rb-orange-tint-fg',
  dormant: 'bg-rb-red-tint-fg',
};

export function CRMOverview() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    getCustomerSegments({ limit: 3 })
      .then((data) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'error', message: 'Terjadi kesalahan memuat data CRM.' }));
  }, []);

  return (
    <>
      <PageHeader title="CRM & Customer" subtitle="Retensi, segmentasi, dan peluang reaktivasi pelanggan" />

      {state.status === 'loading' && <LoadingState label="Memuat data CRM..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard value={state.data.kpis.active_customers} label="Active" tint="blue" />
            <StatCard value={state.data.kpis.new_customers} label="New" tint="green" />
            <StatCard value={state.data.kpis.repeat_customers} label="Repeat" tint="red" />
            <StatCard value={state.data.kpis.dormant_customers} label="Dormant" tint="orange" />
            <StatCard value={state.data.kpis.avg_visit_interval_days !== null ? `${state.data.kpis.avg_visit_interval_days} hari` : '—'} label="Avg Visit Interval" tint="purple" />
          </section>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-serif text-base font-semibold text-rb-text">Segmentasi Pelanggan</h2>
                <LiveBadge />
              </div>
              <div className="flex flex-col gap-3">
                {state.data.segments.map((s) => {
                  const totalKnown = state.data.segments.reduce((sum, seg) => sum + seg.count, 0);
                  const pct = totalKnown > 0 ? Math.round((s.count / totalKnown) * 100) : 0;
                  return (
                    <div key={s.key} className="flex items-center gap-3 text-sm">
                      <span className={`h-2.5 w-2.5 rounded-sm ${SEGMENT_COLORS[s.key]}`} />
                      <span className="w-36 shrink-0 font-medium text-rb-text-secondary">{s.label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-rb-divider">
                        <div className={`h-full rounded-full ${SEGMENT_COLORS[s.key]}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-10 shrink-0 text-right text-rb-text-muted">{s.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
              <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Peluang Reaktivasi</h2>
              <div className="mb-3 rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2.5 text-sm">
                <span className="font-semibold text-rb-text-secondary">{state.data.kpis.dormant_customers} pelanggan dormant</span>
                <span className="block text-xs text-rb-text-muted">Belum kunjungan 60+ hari</span>
              </div>
              <EmptyState
                title="UNAVAILABLE"
                description="Poin akan hangus dan ulang tahun bulan ini belum memiliki sumber data — tidak ditampilkan agar tidak mengarang informasi."
              />
            </div>
          </div>

          <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
            <div className="border-b border-rb-divider px-4 py-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
              Customer 360 — Contoh
            </div>
            <div className="flex flex-col divide-y divide-rb-divider">
              {state.data.customers.items.map((c) => (
                <Link
                  key={c.customer_key}
                  to={`/crm/customers/${encodeURIComponent(c.customer_key)}`}
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-rb-bg"
                >
                  <div>
                    <div className="font-medium text-rb-text-secondary">{c.name}</div>
                    <div className="text-xs text-rb-text-muted">{c.favorite_branch ?? '—'} · {c.total_visits} visit</div>
                  </div>
                  <span className="text-rb-red font-semibold">Lihat 360 →</span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
