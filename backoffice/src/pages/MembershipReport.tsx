import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { getMembership, type MemberProfile } from '../services/crm';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: MemberProfile[] };

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function MembershipReport() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    getMembership()
      .then((data) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'error', message: 'Terjadi kesalahan memuat membership report.' }));
  }, []);

  if (state.status === 'loading') return <LoadingState label="Memuat membership report..." />;
  if (state.status === 'error') return <ErrorState message={state.message} />;

  const members = state.data;
  const activeMembers = members.filter((m) => m.membership_status === 'ACTIVE').length;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const newThisMonth = members.filter((m) => monthKey(m.created_at) === thisMonth).length;

  const tierCounts = new Map<string, number>();
  for (const m of members) {
    tierCounts.set(m.current_tier, (tierCounts.get(m.current_tier) || 0) + 1);
  }
  const tiers = [...tierCounts.entries()].map(([tier, count]) => ({ tier, count }));

  const growthByMonth = new Map<string, number>();
  const anchor = new Date();
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push(key);
    growthByMonth.set(key, 0);
  }
  const cumulativeBefore = months.length > 0
    ? members.filter((m) => monthKey(m.created_at) < months[0]).length
    : 0;
  for (const m of members) {
    const key = monthKey(m.created_at);
    if (growthByMonth.has(key)) growthByMonth.set(key, (growthByMonth.get(key) || 0) + 1);
  }
  let running = cumulativeBefore;
  const growth = months.map((month) => {
    running += growthByMonth.get(month) || 0;
    return { month, cumulative: running };
  });
  const maxCumulative = Math.max(...growth.map((x) => x.cumulative), 1);

  return (
    <>
      <Link to="/reports" className="mb-2.5 inline-block text-sm font-semibold text-rb-text-muted">← Reports</Link>
      <PageHeader title="Membership Report" />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value={activeMembers} label="Active Members" tint="teal" />
        <StatCard value={newThisMonth} label="New This Month" tint="green" />
        <StatCard value="—" label="Points Issued" tint="yellow" />
        <StatCard value="—" label="Points Redeemed" tint="purple" />
      </section>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Distribusi Tier</h2>
          <div className="flex flex-col gap-2">
            {tiers.map(({ tier, count }) => (
              <div key={tier} className="flex items-center justify-between text-sm">
                <span className="font-medium text-rb-text-secondary">{tier}</span>
                <span className="text-rb-text-muted">{count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Member Growth — 6 Bulan</h2>
          <div className="flex items-end gap-3" style={{ height: 120 }}>
            {growth.map((g) => {
              const heightPct = Math.round((g.cumulative / maxCumulative) * 100);
              return (
                <div key={g.month} className="flex flex-1 flex-col items-center gap-1.5" style={{ height: '100%', justifyContent: 'flex-end' }}>
                  <div className="w-full rounded-t bg-rb-teal-tint-fg" style={{ height: `${heightPct}%` }} />
                  <span className="text-[11px] text-rb-text-muted">{g.month.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Points Earned vs Redeemed</h2>
          <EmptyState title="UNAVAILABLE" description="Riwayat transaksi poin (member_point_transactions) belum diekspos melalui endpoint admin — tidak ditampilkan agar tidak mengarang angka." />
        </div>
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Membership by Branch</h2>
          <EmptyState title="UNAVAILABLE" description="Data member tidak memiliki kolom cabang — tidak ditampilkan agar tidak mengarang angka." />
        </div>
      </div>
    </>
  );
}
