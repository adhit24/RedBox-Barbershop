import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { LiveBadge } from '../components/LiveBadge';
import { PeriodSelector } from '../components/PeriodSelector';
import { BranchSelector } from '../components/BranchSelector';
import {
  getOwnerOverview,
  getOwnerRevenue,
  getMembership,
  type OwnerOverview,
  type OwnerRevenue,
  type MemberProfile,
  type RevenuePeriod,
} from '../services/crm';
import { getMokaStatus, type MokaStatus } from '../services/moka';

function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

export function CommandCenter() {
  const [period, setPeriod] = useState<RevenuePeriod>('month');
  const [branch, setBranch] = useState('all');

  const [overview, setOverview] = useState<LoadState<OwnerOverview>>({ status: 'loading' });
  const [revenue, setRevenue] = useState<LoadState<OwnerRevenue>>({ status: 'loading' });
  const [moka, setMoka] = useState<LoadState<MokaStatus>>({ status: 'loading' });
  const [membership, setMembership] = useState<LoadState<MemberProfile[]>>({ status: 'loading' });

  useEffect(() => {
    getOwnerOverview()
      .then((data) => setOverview({ status: 'ready', data }))
      .catch(() => setOverview({ status: 'error', message: 'Terjadi kesalahan memuat ringkasan cabang.' }));
  }, []);

  useEffect(() => {
    getMokaStatus()
      .then((data) => setMoka({ status: 'ready', data }))
      .catch(() => setMoka({ status: 'error', message: 'Terjadi kesalahan memuat status Moka.' }));
  }, []);

  useEffect(() => {
    getMembership()
      .then((data) => setMembership({ status: 'ready', data }))
      .catch(() => setMembership({ status: 'error', message: 'Terjadi kesalahan memuat data membership.' }));
  }, []);

  useEffect(() => {
    setRevenue({ status: 'loading' });
    getOwnerRevenue({ branch, period })
      .then((data) => setRevenue({ status: 'ready', data }))
      .catch(() => setRevenue({ status: 'error', message: 'Terjadi kesalahan memuat data revenue.' }));
  }, [branch, period]);

  const activeMembers = membership.status === 'ready'
    ? membership.data.filter((m) => m.membership_status === 'ACTIVE').length
    : null;

  return (
    <>
      <PageHeader
        title="Command Center"
        subtitle={new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        actions={
          <div className="flex items-center gap-2">
            <BranchSelector
              value={branch}
              branches={overview.status === 'ready' ? overview.data.branches.map((b) => ({ slug: b.slug, name: b.name })) : []}
              onChange={setBranch}
            />
            <PeriodSelector value={period} onChange={setPeriod} />
          </div>
        }
      />

      {/* KPI row — real fields only, spec §8a / disclosed design deviation */}
      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {revenue.status === 'loading' && <LoadingState label="Memuat KPI..." />}
        {revenue.status === 'error' && <ErrorState message={revenue.message} />}
        {revenue.status === 'ready' && (
          <>
            <StatCard value={formatRupiah(revenue.data.summary.revenue_moka + revenue.data.summary.revenue_web)} label="Revenue" tint="red" />
            <StatCard value={revenue.data.summary.tx_total} label="Transaksi" tint="green" />
            <StatCard value={formatRupiah(revenue.data.summary.avg_tx)} label="Rata-rata Transaksi" tint="blue" />
          </>
        )}
        {overview.status === 'loading' && <LoadingState label="Memuat..." />}
        {overview.status === 'error' && <ErrorState message={overview.message} />}
        {overview.status === 'ready' && (
          <>
            <StatCard
              value={`${overview.data.totals.hadir}/${overview.data.branches.reduce((s, b) => s + b.total_barbers, 0)}`}
              label="Kehadiran Barber Hari Ini"
              tint="orange"
            />
            <StatCard value={overview.data.totals.pending} label="Booking Pending Hari Ini" tint="purple" />
          </>
        )}
        {membership.status === 'loading' && <LoadingState label="Memuat..." />}
        {membership.status === 'error' && <ErrorState message={membership.message} />}
        {membership.status === 'ready' && <StatCard value={activeMembers} label="Member Aktif" tint="teal" />}
      </section>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Branch performance */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-rb-text">Performa Cabang</h2>
            <LiveBadge />
          </div>
          {revenue.status === 'loading' && <LoadingState />}
          {revenue.status === 'error' && <ErrorState message={revenue.message} />}
          {revenue.status === 'ready' && (
            <div className="flex flex-col divide-y divide-rb-divider">
              {revenue.data.branch_compare.map((b) => (
                <div key={b.slug} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-medium text-rb-text-secondary">{b.name}</span>
                  <span className="text-rb-text-muted">{formatRupiah(b.revenue_moka + b.revenue_web)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Barber leaderboard */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-rb-text">Barber Terbaik</h2>
            <LiveBadge />
          </div>
          {revenue.status === 'loading' && <LoadingState />}
          {revenue.status === 'error' && <ErrorState message={revenue.message} />}
          {revenue.status === 'ready' && (
            <div className="flex flex-col divide-y divide-rb-divider">
              {revenue.data.top_barbers.map((b) => (
                <div key={b.barber_id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-medium text-rb-text-secondary">{b.name}</span>
                  <span className="text-rb-text-muted">{formatRupiah(b.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Moka health */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-rb-text">Integrasi Moka</h2>
            <LiveBadge />
          </div>
          {moka.status === 'loading' && <LoadingState />}
          {moka.status === 'error' && <ErrorState message={moka.message} />}
          {moka.status === 'ready' && (
            <div className="flex flex-col divide-y divide-rb-divider">
              {moka.data.outlets.map((o) => (
                <div key={o.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-medium text-rb-text-secondary">{o.name}</span>
                  <span className={o.tokenExpired ? 'text-rb-red-tint-fg' : 'text-rb-green-tint-fg'}>
                    {o.hasToken ? (o.tokenExpired ? 'Token kedaluwarsa' : 'Terhubung') : 'Belum terhubung'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inventory — UNAVAILABLE, spec §8a owner decision */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-rb-text">Inventory Snapshot</h2>
          </div>
          <EmptyState
            title="UNAVAILABLE"
            description="Data Stockist belum bisa diakses dari Backoffice (kendala akses backend, bukan data kosong). Menunggu keputusan terpisah."
          />
        </div>
      </div>
    </>
  );
}
