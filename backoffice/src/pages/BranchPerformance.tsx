import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { getOwnerRevenue, getCustomerSegments } from '../services/crm';

interface BranchRow {
  slug: string;
  name: string;
  customers: number;
  repeatCustomers: number;
  transactions: number;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: BranchRow[] };

export function BranchPerformance() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    Promise.all([getOwnerRevenue({ branch: 'all', period: 'month' }), getCustomerSegments({ limit: 1 })])
      .then(([revenue, segments]) => {
        const byBranchMap = new Map(segments.by_branch.map((b) => [b.branch, b]));
        const rows: BranchRow[] = revenue.branch_compare.map((b) => {
          const seg = byBranchMap.get(b.slug);
          return {
            slug: b.slug,
            name: b.name,
            customers: seg?.total_customers ?? 0,
            repeatCustomers: seg?.repeat_customers ?? 0,
            transactions: b.tx_total,
          };
        });
        setState({ status: 'ready', rows });
      })
      .catch(() => setState({ status: 'error', message: 'Terjadi kesalahan memuat branch performance.' }));
  }, []);

  return (
    <>
      <Link to="/reports" className="mb-2.5 inline-block text-sm font-semibold text-rb-text-muted">← Reports</Link>
      <PageHeader title="Branch Performance" />

      {state.status === 'loading' && <LoadingState label="Memuat branch performance..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
          <div className="grid grid-cols-4 gap-2 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted border-b border-rb-divider">
            <div>Cabang</div><div>Customer</div><div>Transaksi</div><div>Repeat</div>
          </div>
          <div className="flex flex-col divide-y divide-rb-divider">
            {state.rows.map((r) => (
              <div key={r.slug} className="grid grid-cols-4 items-center gap-2 px-4 py-3 text-sm">
                <div className="font-semibold text-rb-text">{r.name}</div>
                <div className="text-rb-text-secondary">{r.customers}</div>
                <div className="text-rb-text-secondary">{r.transactions}</div>
                <div className="text-rb-text-secondary">{r.customers > 0 ? `${Math.round((r.repeatCustomers / r.customers) * 100)}%` : '—'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
