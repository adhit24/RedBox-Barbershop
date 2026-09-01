import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { LiveBadge } from '../components/LiveBadge';
import { BranchSelector } from '../components/BranchSelector';
import {
  getOwnerOverview,
  getCommandCenterForBranch,
  getCustomerSegments,
  getBarberPerformance,
  getMembership,
  type OwnerOverview,
  type CommandCenterBranchData,
  type CustomerSegmentsResult,
  type BarberPerformanceResult,
  type MemberProfile,
} from '../services/crm';
import { getMokaSyncLogs, type MokaSyncLogEntry } from '../services/moka';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

interface BranchActivity {
  slug: string;
  name: string;
  bookingToday: number;
  pending: number;
  belumCheckIn: number;
  alerts: { type: string; message: string }[];
}

const OPERATIONAL_TIMEZONE = 'Asia/Jakarta';

function jakartaDateString(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: OPERATIONAL_TIMEZONE });
}

function jakartaYearMonth(iso: string): string {
  return jakartaDateString(iso).slice(0, 7);
}

function UnavailableStat({ label }: { label: string }) {
  return (
    <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
      <div className="font-serif text-2xl font-semibold text-rb-text-faint">—</div>
      <div className="mt-1 text-sm font-semibold text-rb-text-secondary">{label}</div>
      <div className="mt-1 text-xs text-rb-text-faint">Belum tersedia</div>
    </div>
  );
}

function AttentionPill({ label, count, unavailable }: { label: string; count?: number; unavailable?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-rb-pill border border-rb-border bg-rb-surface px-3.5 py-2 text-sm">
      <span
        className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
          unavailable
            ? 'bg-rb-divider text-rb-text-faint'
            : count && count > 0
              ? 'bg-rb-red-tint-bg text-rb-red-tint-fg'
              : 'bg-rb-green-tint-bg text-rb-green-tint-fg'
        }`}
      >
        {unavailable ? '—' : count}
      </span>
      <span className="font-medium text-rb-text-secondary">{label}</span>
    </div>
  );
}

function SnapshotCard({
  title,
  href,
  stats,
  unavailable,
}: {
  title: string;
  href: string;
  stats?: { value: string | number; label: string }[];
  unavailable?: boolean;
}) {
  return (
    <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-serif text-base font-semibold text-rb-text">{title}</h3>
        {unavailable && (
          <span className="rounded-rb-pill bg-rb-divider px-2 py-0.5 text-[10.5px] font-semibold text-rb-text-faint">
            UNAVAILABLE
          </span>
        )}
      </div>
      {unavailable ? (
        <p className="text-sm text-rb-text-faint">Data belum bisa diakses dari Backoffice.</p>
      ) : (
        <div className="flex gap-6">
          {stats?.map((s) => (
            <div key={s.label}>
              <div className="font-serif text-xl font-semibold text-rb-text">{s.value}</div>
              <div className="text-xs text-rb-text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      )}
      <a href={href} className="mt-4 inline-block text-sm font-medium text-rb-red hover:underline">
        Lihat {title} →
      </a>
    </div>
  );
}

export function CommandCenter() {
  const [branch, setBranch] = useState('all');

  const [overview, setOverview] = useState<LoadState<OwnerOverview>>({ status: 'loading' });
  const [branchActivity, setBranchActivity] = useState<LoadState<{ items: BranchActivity[]; failedBranches: string[] }>>({ status: 'loading' });
  const [segments, setSegments] = useState<LoadState<CustomerSegmentsResult>>({ status: 'loading' });
  const [barberPerf, setBarberPerf] = useState<LoadState<BarberPerformanceResult>>({ status: 'loading' });
  const [membership, setMembership] = useState<LoadState<MemberProfile[]>>({ status: 'loading' });
  const [mokaLogs, setMokaLogs] = useState<LoadState<MokaSyncLogEntry[]>>({ status: 'loading' });

  useEffect(() => {
    getOwnerOverview()
      .then((data) => setOverview({ status: 'ready', data }))
      .catch(() => setOverview({ status: 'error', message: 'Terjadi kesalahan memuat ringkasan cabang.' }));
  }, []);

  useEffect(() => {
    if (overview.status !== 'ready') return;
    let cancelled = false;

    const targets = branch === 'all' ? overview.data.branches : overview.data.branches.filter((b) => b.slug === branch);

    (async () => {
      const results = await Promise.allSettled(targets.map((b) => getCommandCenterForBranch(b.slug)));
      const items: BranchActivity[] = [];
      const failedBranches: string[] = [];

      results.forEach((result, i) => {
        const b = targets[i];
        if (result.status === 'rejected') {
          failedBranches.push(b.name);
          return;
        }
        const data: CommandCenterBranchData = result.value;
        items.push({
          slug: b.slug,
          name: b.name,
          bookingToday: data.stats.booking_today,
          pending: data.stats.pending,
          belumCheckIn: data.stats.belum_check_in,
          alerts: data.alerts,
        });
      });

      if (!cancelled) setBranchActivity({ status: 'ready', data: { items, failedBranches } });
    })();

    return () => {
      cancelled = true;
    };
  }, [overview, branch]);

  useEffect(() => {
    getCustomerSegments({ branch, limit: 1 })
      .then((data) => setSegments({ status: 'ready', data }))
      .catch(() => setSegments({ status: 'error', message: 'Terjadi kesalahan memuat data customer.' }));
  }, [branch]);

  useEffect(() => {
    getBarberPerformance({ branch })
      .then((data) => setBarberPerf({ status: 'ready', data }))
      .catch(() => setBarberPerf({ status: 'error', message: 'Terjadi kesalahan memuat data barber.' }));
  }, [branch]);

  useEffect(() => {
    getMembership()
      .then((data) => setMembership({ status: 'ready', data }))
      .catch(() => setMembership({ status: 'error', message: 'Terjadi kesalahan memuat data membership.' }));
  }, []);

  useEffect(() => {
    getMokaSyncLogs({ limit: 200 })
      .then((data) => setMokaLogs({ status: 'ready', data: data.logs }))
      .catch(() => setMokaLogs({ status: 'error', message: 'Terjadi kesalahan memuat log sinkronisasi Moka.' }));
  }, []);

  const bookingToday = branchActivity.status === 'ready' ? branchActivity.data.items.reduce((s, b) => s + b.bookingToday, 0) : null;
  const pendingTotal = branchActivity.status === 'ready' ? branchActivity.data.items.reduce((s, b) => s + b.pending, 0) : null;
  const belumCheckInTotal = branchActivity.status === 'ready' ? branchActivity.data.items.reduce((s, b) => s + b.belumCheckIn, 0) : null;
  const branchAlerts = branchActivity.status === 'ready' ? branchActivity.data.items.flatMap((b) => b.alerts.map((a) => ({ ...a, branch: b.name }))) : [];

  const todayJakarta = jakartaDateString(new Date().toISOString());
  const thisMonthJakarta = todayJakarta.slice(0, 7);

  const activeMembers = membership.status === 'ready' ? membership.data.filter((m) => m.membership_status === 'ACTIVE').length : null;
  // "Bulan ini" = actually activated this month, per membership_activated_at — created_at is
  // when the record was created (may predate activation) and is not a valid proxy.
  const activatedThisMonth = membership.status === 'ready'
    ? membership.data.filter(
        (m) => m.membership_status === 'ACTIVE' && m.membership_activated_at && jakartaYearMonth(m.membership_activated_at) === thisMonthJakarta
      ).length
    : null;
  const membershipIsNetworkWide = branch !== 'all';

  const todayMokaLogs = mokaLogs.status === 'ready' ? mokaLogs.data.filter((l) => jakartaDateString(l.created_at) === todayJakarta) : [];

  const topBranch = branchActivity.status === 'ready' && branchActivity.data.items.length > 0
    ? [...branchActivity.data.items].sort((a, b) => b.bookingToday - a.bookingToday)[0]
    : null;

  const topBarber = barberPerf.status === 'ready' && barberPerf.data.barbers.length > 0
    ? [...barberPerf.data.barbers].sort((a, b) => b.customers_served - a.customers_served)[0]
    : null;

  const errorLogs = mokaLogs.status === 'ready' ? mokaLogs.data.filter((l) => l.status !== 'ok') : [];

  const actionItems: { key: string; text: string }[] = [];
  if (pendingTotal) actionItems.push({ key: 'pending', text: `${pendingTotal} booking menunggu konfirmasi` });
  if (belumCheckInTotal) actionItems.push({ key: 'checkin', text: `${belumCheckInTotal} barber belum check-in hari ini` });
  branchAlerts.forEach((a, i) => actionItems.push({ key: `alert-${i}`, text: `${a.branch}: ${a.message}` }));

  return (
    <>
      <PageHeader
        title="Command Center"
        subtitle="Ringkasan operasional hari ini"
        actions={
          <div className="flex items-center gap-2">
            <BranchSelector
              value={branch}
              branches={overview.status === 'ready' ? overview.data.branches.map((b) => ({ slug: b.slug, name: b.name })) : []}
              onChange={setBranch}
            />
            <span className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-2 text-sm text-rb-text-secondary">
              Hari Ini
            </span>
            <LiveBadge />
          </div>
        }
      />

      {/* Perlu Perhatian Hari Ini */}
      <section className="mb-6 flex flex-wrap gap-2.5">
        <AttentionPill label="Attendance Issues" unavailable />
        <AttentionPill label="Payroll Pending" unavailable />
        <AttentionPill label="Booking Issues" count={pendingTotal ?? 0} />
        <AttentionPill label="Low Stock Alerts" unavailable />
      </section>

      {/* KPI row — operational only, no financial metrics (spec correction 2026-09-01) */}
      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {branchActivity.status === 'loading' && <LoadingState label="Memuat KPI..." />}
        {branchActivity.status === 'error' && <ErrorState message={branchActivity.message} />}
        {branchActivity.status === 'ready' && <StatCard value={bookingToday} label="Booking Hari Ini" tint="red" />}

        <UnavailableStat label="Completed Services" />

        {segments.status === 'loading' && <LoadingState label="Memuat..." />}
        {segments.status === 'error' && <ErrorState message={segments.message} />}
        {segments.status === 'ready' && <StatCard value={segments.data.kpis.repeat_customers} label="Repeat Customers" tint="blue" />}

        <UnavailableStat label="Attendance Alerts" />

        {membership.status === 'loading' && <LoadingState label="Memuat..." />}
        {membership.status === 'error' && <ErrorState message={membership.message} />}
        {membership.status === 'ready' && (
          <StatCard
            value={activeMembers}
            label="Active Members"
            trend={
              membershipIsNetworkWide
                ? 'Seluruh Cabang — data membership belum ada atribusi cabang'
                : activatedThisMonth
                  ? `+${activatedThisMonth} bulan ini`
                  : undefined
            }
            tint="teal"
          />
        )}

        <UnavailableStat label="Payroll Pending" />
      </section>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Live Branch Activity */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-rb-text">Live Branch Activity</h2>
            <LiveBadge partial />
          </div>
          {branchActivity.status === 'loading' && <LoadingState />}
          {branchActivity.status === 'error' && <ErrorState message={branchActivity.message} />}
          {branchActivity.status === 'ready' && (
            <>
              {branchActivity.data.failedBranches.length > 0 && (
                <div className="mb-3 rounded-rb-button border border-rb-orange-tint-fg/30 bg-rb-orange-tint-bg px-3 py-2 text-xs text-rb-orange-tint-fg">
                  Gagal memuat data untuk: {branchActivity.data.failedBranches.join(', ')}.
                </div>
              )}
              <div className="flex flex-col divide-y divide-rb-divider">
                {branchActivity.data.items.map((b) => (
                  <div key={b.slug} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="font-medium text-rb-text-secondary">{b.name}</span>
                    <div className="flex items-center gap-3 text-xs text-rb-text-muted">
                      <span>{b.bookingToday} booking</span>
                      {b.alerts.length > 0 && (
                        <span className="rounded-rb-pill bg-rb-red-tint-bg px-2 py-0.5 font-semibold text-rb-red-tint-fg">
                          {b.alerts.length} alert
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Action Center */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-rb-text">Action Center</h2>
            <LiveBadge partial />
          </div>
          {branchActivity.status === 'loading' && <LoadingState />}
          {branchActivity.status === 'error' && <ErrorState message={branchActivity.message} />}
          {branchActivity.status === 'ready' && (
            actionItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-rb-text-muted">Tidak ada tindakan mendesak saat ini.</p>
            ) : (
              <div className="flex flex-col divide-y divide-rb-divider">
                {actionItems.map((item) => (
                  <div key={item.key} className="py-2.5 text-sm text-rb-text-secondary">
                    {item.text}
                  </div>
                ))}
              </div>
            )
          )}
          <p className="mt-4 text-[11.5px] text-rb-text-faint">
            Payroll dan Stockist belum terhubung ke Action Center — belum ada sumber data untuk domain tersebut.
          </p>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Today's Operations Timeline */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-rb-text">Today's Operations Timeline</h2>
            <LiveBadge partial />
          </div>
          {mokaLogs.status === 'loading' && <LoadingState />}
          {mokaLogs.status === 'error' && <ErrorState message={mokaLogs.message} />}
          {mokaLogs.status === 'ready' && (
            todayMokaLogs.length === 0 ? (
              <p className="py-6 text-center text-sm text-rb-text-muted">Belum ada aktivitas sinkronisasi hari ini.</p>
            ) : (
              <div className="flex flex-col divide-y divide-rb-divider">
                {todayMokaLogs.map((log) => (
                  <div key={log.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="w-14 shrink-0 text-xs text-rb-text-muted">
                      {new Date(log.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="flex-1 text-rb-text-secondary">
                      Sinkronisasi {log.direction} {log.entity_type}
                    </span>
                    <span className={`text-xs ${log.status === 'ok' ? 'text-rb-green-tint-fg' : 'text-rb-red-tint-fg'}`}>
                      {log.status}
                    </span>
                  </div>
                ))}
              </div>
            )
          )}
          <p className="mt-4 text-[11.5px] text-rb-text-faint">
            Sumber: log sinkronisasi Moka. Belum ada log aktivitas untuk domain Attendance/Payroll/Stockist.
          </p>
        </div>

        {/* Alerts & Exceptions */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-rb-text">Alerts & Exceptions</h2>
            <LiveBadge partial />
          </div>
          {mokaLogs.status === 'loading' && <LoadingState />}
          {mokaLogs.status === 'error' && <ErrorState message={mokaLogs.message} />}
          {mokaLogs.status === 'ready' && (
            errorLogs.length === 0 ? (
              <p className="py-6 text-center text-sm text-rb-text-muted">Tidak ada exception sinkronisasi hari ini.</p>
            ) : (
              <div className="flex flex-col divide-y divide-rb-divider">
                {errorLogs.map((log) => (
                  <div key={log.id} className="py-2.5 text-sm">
                    <div className="font-medium text-rb-red-tint-fg">
                      Sinkronisasi {log.direction} {log.entity_type} gagal
                    </div>
                    <div className="text-xs text-rb-text-muted">{log.error_message ?? 'Tidak ada detail error.'}</div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* Business Snapshots */}
      <section className="mb-8">
        <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Business Snapshots</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SnapshotCard
            title="Customer"
            href="/crm"
            stats={
              segments.status === 'ready'
                ? [
                    { value: segments.data.kpis.active_customers, label: 'Active Customers' },
                    { value: segments.data.kpis.new_customers, label: 'New Customers' },
                  ]
                : undefined
            }
          />
          <SnapshotCard
            title="Membership"
            href="/reports/membership"
            stats={
              membership.status === 'ready'
                ? [
                    { value: activeMembers ?? 0, label: membershipIsNetworkWide ? 'Active Members (Seluruh Cabang)' : 'Active Members' },
                    { value: activatedThisMonth ?? 0, label: membershipIsNetworkWide ? 'Baru Bulan Ini (Seluruh Cabang)' : 'Baru Bulan Ini' },
                  ]
                : undefined
            }
          />
          <SnapshotCard
            title="Branch Performance"
            href="/operations"
            stats={
              topBranch
                ? [
                    { value: topBranch.bookingToday, label: `${topBranch.name} (Terbanyak)` },
                    { value: branchActivity.status === 'ready' ? branchActivity.data.items.length : 0, label: 'Cabang Aktif' },
                  ]
                : undefined
            }
          />
          <SnapshotCard
            title="Barber Performance"
            href="/crm"
            stats={
              barberPerf.status === 'ready'
                ? [
                    { value: barberPerf.data.barbers.length, label: 'Barber Terpantau' },
                    { value: topBarber ? topBarber.name : '—', label: 'Customer Terbanyak' },
                  ]
                : undefined
            }
          />
          <SnapshotCard title="Inventory" href="/stockist" unavailable />
          <SnapshotCard title="Payroll" href="/payroll" unavailable />
        </div>
      </section>
    </>
  );
}
