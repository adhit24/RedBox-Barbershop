import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { LiveBadge } from '../components/LiveBadge';
import { BranchSelector } from '../components/BranchSelector';
import { useAuth } from '../auth/AuthProvider';
import {
  CalendarIcon,
  CheckIcon,
  RepeatIcon,
  AlertClockIcon,
  MemberIcon,
  WalletClockIcon,
  BoxIcon,
} from '../components/icons';
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
import { getYearlyPerformance, type MonthlyPerformancePoint } from '../services/performance';
import { YearlyPerformanceChart } from '../components/YearlyPerformanceChart';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

interface BranchActivity {
  slug: string;
  name: string;
  bookingToday: number;
  pending: number;
  capacity?: CommandCenterBranchData['capacity'];
  freshness?: CommandCenterBranchData['freshness'];
  barbers?: CommandCenterBranchData['barbers'];
  alerts?: CommandCenterBranchData['alerts'];
}

const OPERATIONAL_TIMEZONE = 'Asia/Jakarta';

function jakartaDateString(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: OPERATIONAL_TIMEZONE });
}

function jakartaYearMonth(iso: string): string {
  return jakartaDateString(iso).slice(0, 7);
}

function initialsOf(label: string): string {
  const parts = label.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

// Category tint pairs — from design_handoff_command_center/README.md §Colors.
// Each data category keeps a consistent tint across every screen.
const TINT = {
  red: { bg: '#FCEAE7', fg: '#C0402A' },
  orange: { bg: '#FCEEDF', fg: '#C07A24' },
  green: { bg: '#E5F3EA', fg: '#2F8F53' },
  blue: { bg: '#E7EEF6', fg: '#3E6FA6' },
  purple: { bg: '#EEEAF6', fg: '#7159AC' },
  teal: { bg: '#E2F1EC', fg: '#23806E' },
  yellow: { bg: '#FBF1DC', fg: '#AD8A22' },
} as const;
type TintKey = keyof typeof TINT;

function KpiCard({
  icon,
  value,
  label,
  trend,
  tint,
  href,
  unavailable,
}: {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  trend?: string;
  tint: TintKey;
  href?: string;
  unavailable?: boolean;
}) {
  const t = TINT[tint];
  const body = (
    <div
      className="rounded-rb-card p-[18px] transition-transform duration-150 ease-out hover:-translate-y-0.5"
      style={{ background: t.bg }}
    >
      <div
        className="mb-2.5 flex h-[34px] w-[34px] items-center justify-center rounded-[10px]"
        style={{ background: 'rgba(255,255,255,0.6)', color: t.fg }}
      >
        {icon}
      </div>
      <div className="font-serif text-[26px] leading-none font-semibold text-rb-text">{unavailable ? '—' : value}</div>
      <div className="mt-1 text-[12.5px] font-semibold text-rb-text-secondary">{label}</div>
      <div className="mt-1.5 text-[11.5px] font-medium" style={{ color: t.fg }}>
        {unavailable ? 'Belum tersedia' : trend}
      </div>
    </div>
  );
  return href ? (
    <Link to={href} className="block no-underline">
      {body}
    </Link>
  ) : (
    body
  );
}

function PriorityPill({
  icon,
  label,
  count,
  tint,
  href,
  unavailable,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  tint: TintKey;
  href?: string;
  unavailable?: boolean;
}) {
  const t = TINT[tint];
  const content = (
    <>
      <span style={{ display: 'flex', color: t.fg }}>{icon}</span>
      {unavailable ? '— ' : `${count} `}
      {label}
    </>
  );
  const className = 'flex items-center gap-[7px] whitespace-nowrap rounded-rb-pill px-3.5 py-[7px] text-[13px] font-semibold no-underline';
  const style = { background: t.bg, color: t.fg };
  return href ? (
    <Link to={href} className={className} style={style}>
      {content}
    </Link>
  ) : (
    <span className={className} style={style}>
      {content}
    </span>
  );
}

function SnapshotCard({
  title,
  href,
  cta,
  accent,
  stats,
  unavailable,
}: {
  title: string;
  href: string;
  cta: string;
  accent: string;
  stats?: { value: string | number; label: string }[];
  unavailable?: boolean;
}) {
  return (
    <div className="rounded-rb-card border border-rb-border bg-rb-surface p-[18px]">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-semibold text-rb-text">{title}</div>
        {unavailable && (
          <span className="rounded-rb-pill bg-rb-divider px-2 py-0.5 text-[10.5px] font-semibold text-rb-text-faint">
            UNAVAILABLE
          </span>
        )}
      </div>
      {unavailable ? (
        <p className="mb-3.5 text-sm text-rb-text-faint">Data belum bisa diakses dari Backoffice.</p>
      ) : (
        <div className="mb-3.5 flex gap-[18px]">
          {stats?.map((s) => (
            <div key={s.label}>
              <div className="font-serif text-[21px] font-semibold" style={{ color: accent }}>
                {s.value}
              </div>
              <div className="text-[11.5px] text-rb-text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      )}
      <Link to={href} className="text-[12.5px] font-semibold no-underline" style={{ color: unavailable ? '#8A8479' : '#C72820' }}>
        {cta} →
      </Link>
    </div>
  );
}

export function CommandCenter() {
  const { currentUser } = useAuth();
  const [branch, setBranch] = useState('all');

  const [overview, setOverview] = useState<LoadState<OwnerOverview>>({ status: 'loading' });
  const [branchActivity, setBranchActivity] = useState<LoadState<{ items: BranchActivity[]; failedBranches: string[] }>>({ status: 'loading' });
  const [segments, setSegments] = useState<LoadState<CustomerSegmentsResult>>({ status: 'loading' });
  const [barberPerf, setBarberPerf] = useState<LoadState<BarberPerformanceResult>>({ status: 'loading' });
  const [membership, setMembership] = useState<LoadState<MemberProfile[]>>({ status: 'loading' });
  const [yearlyPerformance, setYearlyPerformance] = useState<LoadState<MonthlyPerformancePoint[]>>({ status: 'loading' });

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
          capacity: data.capacity,
          freshness: data.freshness,
          barbers: data.barbers,
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
    getYearlyPerformance(branch)
      .then((data) => setYearlyPerformance({ status: 'ready', data }))
      .catch(() => setYearlyPerformance({ status: 'error', message: 'Terjadi kesalahan memuat data performa tahunan.' }));
  }, [branch]);

  const bookingToday = branchActivity.status === 'ready' ? branchActivity.data.items.reduce((s, b) => s + b.bookingToday, 0) : null;
  const pendingTotal = branchActivity.status === 'ready' ? branchActivity.data.items.reduce((s, b) => s + b.pending, 0) : null;

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

  const topBranch = branchActivity.status === 'ready' && branchActivity.data.items.length > 0
    ? [...branchActivity.data.items].sort((a, b) => b.bookingToday - a.bookingToday)[0]
    : null;

  const topBarber = barberPerf.status === 'ready' && barberPerf.data.barbers.length > 0
    ? [...barberPerf.data.barbers].sort((a, b) => b.customers_served - a.customers_served)[0]
    : null;

  const actionItems: { key: string; icon: ReactNode; title: string; context: string; tint: TintKey; href: string; cta: string }[] = [];
  if (pendingTotal) {
    actionItems.push({
      key: 'pending',
      icon: <CalendarIcon size={16} />,
      title: `${pendingTotal} booking menunggu konfirmasi`,
      context: 'Lintas cabang · hari ini',
      tint: 'red',
      href: '/operations',
      cta: 'Review',
    });
  }
  const latestMokaFreshness = branchActivity.status === 'ready' && branchActivity.data.items.length > 0
    ? branchActivity.data.items[0].freshness?.moka
    : undefined;

  const capacitySummary = (() => {
    if (branchActivity.status !== 'ready' || branchActivity.data.items.length === 0) return null;
    const readyCapacities = branchActivity.data.items
      .map((i) => i.capacity)
      .filter((c): c is NonNullable<typeof c> => !!c && c.status === 'ready');

    if (readyCapacities.length === 0) {
      const firstUnavailable = branchActivity.data.items.map((i) => i.capacity).find((c) => c?.status === 'unavailable');
      return {
        status: 'unavailable' as const,
        reason: firstUnavailable?.reason || 'Data kapasitas belum tersedia untuk branch ini',
        active_barbers: 0,
        available_barbers: 0,
        serving_barbers: 0,
        home_service_barbers: 0,
        total_slots_today: 0,
        occupied_slots: 0,
        available_slots: 0,
        utilization_percent: 0,
      };
    }

    const totals = readyCapacities.reduce(
      (acc, c) => ({
        active_barbers: acc.active_barbers + (c.active_barbers || 0),
        available_barbers: acc.available_barbers + (c.available_barbers || 0),
        serving_barbers: acc.serving_barbers + (c.serving_barbers || 0),
        home_service_barbers: acc.home_service_barbers + (c.home_service_barbers || 0),
        total_slots_today: acc.total_slots_today + (c.total_slots_today || 0),
        occupied_slots: acc.occupied_slots + (c.occupied_slots || 0),
        available_slots: acc.available_slots + (c.available_slots || 0),
      }),
      {
        active_barbers: 0,
        available_barbers: 0,
        serving_barbers: 0,
        home_service_barbers: 0,
        total_slots_today: 0,
        occupied_slots: 0,
        available_slots: 0,
      }
    );

    const utilization_percent =
      totals.total_slots_today > 0 ? Math.round((totals.occupied_slots / totals.total_slots_today) * 100) : 0;

    return {
      status: 'ready' as const,
      ...totals,
      utilization_percent,
    };
  })();

  const dateSubtitle = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      <PageHeader
        title="Command Center"
        subtitle={`Ringkasan operasional Redbox hari ini · ${dateSubtitle}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <BranchSelector
              value={branch}
              branches={overview.status === 'ready' ? overview.data.branches.map((b) => ({ slug: b.slug, name: b.name })) : []}
              onChange={setBranch}
            />
            <span className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-2 text-sm text-rb-text-secondary">
              Hari Ini
            </span>
            <LiveBadge
              status={latestMokaFreshness?.status}
              ageMinutes={latestMokaFreshness?.age_minutes}
            />
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-rb-purple-tint-bg text-[13px] font-semibold text-rb-purple-tint-fg">
              {initialsOf(currentUser?.label ?? 'Owner')}
            </div>
          </div>
        }
      />

      {/* Perlu Perhatian Hari Ini */}
      <section className="mb-5 flex flex-wrap items-center gap-4 rounded-rb-card border border-rb-border bg-rb-surface px-5 py-4">
        <span className="whitespace-nowrap text-[13.5px] font-semibold text-rb-text">Perlu Perhatian Hari Ini</span>
        <div className="flex flex-1 flex-wrap gap-2.5">
          <PriorityPill icon={<AlertClockIcon size={13} />} label="Attendance Issues" tint="orange" unavailable />
          <PriorityPill icon={<WalletClockIcon size={13} />} label="Payroll Pending" tint="purple" unavailable />
          <PriorityPill icon={<CalendarIcon size={13} />} label="Booking Issues" tint="red" count={pendingTotal ?? 0} href="/operations" />
          <PriorityPill icon={<BoxIcon size={13} />} label="Low Stock Alerts" tint="yellow" unavailable />
        </div>
      </section>

      {/* KPI row — operational only, no financial metrics (spec correction 2026-09-01) */}
      <section className="mb-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {branchActivity.status === 'loading' && <LoadingState label="Memuat KPI..." />}
        {branchActivity.status === 'error' && <ErrorState message={branchActivity.message} />}
        {branchActivity.status === 'ready' && (
          <KpiCard icon={<CalendarIcon size={17} />} value={bookingToday} label="Booking Hari Ini" trend="Live lintas cabang" tint="red" href="/operations" />
        )}

        <KpiCard icon={<CheckIcon size={17} />} value={null} label="Completed Services" tint="green" unavailable />

        {segments.status === 'loading' && <LoadingState label="Memuat..." />}
        {segments.status === 'error' && <ErrorState message={segments.message} />}
        {segments.status === 'ready' && (
          <KpiCard icon={<RepeatIcon size={17} />} value={segments.data.kpis.repeat_customers} label="Repeat Customers" trend="Total tercatat" tint="blue" href="/crm" />
        )}

        <KpiCard icon={<AlertClockIcon size={17} />} value={null} label="Attendance Alerts" tint="orange" href="/attendance/exceptions" unavailable />

        {membership.status === 'loading' && <LoadingState label="Memuat..." />}
        {membership.status === 'error' && <ErrorState message={membership.message} />}
        {membership.status === 'ready' && (
          <KpiCard
            icon={<MemberIcon size={17} />}
            value={activeMembers}
            label="Active Members"
            trend={
              membershipIsNetworkWide
                ? 'Seluruh Cabang — belum ada atribusi cabang'
                : activatedThisMonth
                  ? `+${activatedThisMonth} bulan ini`
                  : 'Tidak ada aktivasi bulan ini'
            }
            tint="teal"
            href="/reports/membership"
          />
        )}

        <KpiCard icon={<WalletClockIcon size={17} />} value={null} label="Payroll Pending" tint="purple" href="/payroll" unavailable />
      </section>

      {/* Capacity & Slot Utilization */}
      {capacitySummary && (
        <section className="mb-5 rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-serif text-[17px] font-semibold text-rb-text">Kapasitas & Utilisasi Slot</h2>
              <p className="text-xs text-rb-text-muted">
                {branch === 'all' ? 'Agregasi kapasitas operasional seluruh cabang hari ini' : `Kapasitas operasional real-time cabang ${branch.toUpperCase()}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {capacitySummary.status === 'ready' ? (
                <span className="rounded-rb-pill bg-rb-green-tint-bg px-2.5 py-1 text-xs font-semibold text-rb-green-tint-fg">
                  UTILISASI {capacitySummary.utilization_percent}%
                </span>
              ) : (
                <span className="rounded-rb-pill bg-rb-divider px-2.5 py-1 text-xs font-semibold text-rb-text-muted">
                  PARTIAL DATA: {capacitySummary.reason}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl bg-rb-bg p-3">
              <div className="text-xs text-rb-text-muted">Barber Tersedia</div>
              <div className="mt-1 text-xl font-semibold text-rb-green-tint-fg">{capacitySummary.available_barbers}</div>
            </div>
            <div className="rounded-xl bg-rb-bg p-3">
              <div className="text-xs text-rb-text-muted">Barber Melayani</div>
              <div className="mt-1 text-xl font-semibold text-rb-purple-tint-fg">{capacitySummary.serving_barbers}</div>
            </div>
            <div className="rounded-xl bg-rb-bg p-3">
              <div className="text-xs text-rb-text-muted">Home Service</div>
              <div className="mt-1 text-xl font-semibold text-rb-teal-tint-fg">{capacitySummary.home_service_barbers}</div>
            </div>
            <div className="rounded-xl bg-rb-bg p-3">
              <div className="text-xs text-rb-text-muted">Slot Terisi</div>
              <div className="mt-1 text-xl font-semibold text-rb-text">{capacitySummary.occupied_slots}</div>
            </div>
            <div className="rounded-xl bg-rb-bg p-3">
              <div className="text-xs text-rb-text-muted">Slot Tersedia</div>
              <div className="mt-1 text-xl font-semibold text-rb-blue-tint-fg">{capacitySummary.available_slots}</div>
            </div>
            <div className="rounded-xl bg-rb-bg p-3">
              <div className="text-xs text-rb-text-muted">Utilisasi Hari Ini</div>
              <div className="mt-1 text-xl font-semibold text-rb-text">{capacitySummary.utilization_percent}%</div>
            </div>
          </div>
        </section>
      )}

      {/* Performance by Year */}
      <div className="mb-5">
        {yearlyPerformance.status === 'loading' && <LoadingState label="Memuat performa tahunan..." />}
        {yearlyPerformance.status === 'error' && <ErrorState message={yearlyPerformance.message} />}
        {yearlyPerformance.status === 'ready' && <YearlyPerformanceChart data={yearlyPerformance.data} branch={branch} />}
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* Live Branch Activity */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3.5 flex items-center justify-between">
            <h2 className="font-serif text-[17px] font-semibold text-rb-text">Live Branch Activity</h2>
            <span className="text-xs text-rb-text-muted">
              {branchActivity.status === 'ready' ? `${branchActivity.data.items.length} cabang` : ''}
            </span>
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
              <div className="flex flex-col gap-2">
                {branchActivity.data.items.map((b) => {
                  const attention = b.pending > 0;
                  return (
                    <Link
                      key={b.slug}
                      to="/reports/branches"
                      className="flex items-center gap-3.5 rounded-xl bg-rb-bg px-3.5 py-3 no-underline hover:bg-rb-divider"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: attention ? TINT.red.fg : TINT.green.fg }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-rb-text">{b.name}</div>
                        <div className="text-xs text-rb-text-muted">
                          {b.bookingToday} booking hari ini
                          {b.capacity && b.capacity.status === 'ready'
                            ? ` · Utilisasi ${b.capacity.utilization_percent}% (${b.capacity.available_barbers} barber ready, ${b.capacity.available_slots} slot)`
                            : ''}
                        </div>
                      </div>
                      <span
                        className="whitespace-nowrap rounded-rb-pill px-2.5 py-1 text-xs font-semibold"
                        style={attention ? { background: TINT.red.bg, color: TINT.red.fg } : { background: TINT.green.bg, color: TINT.green.fg }}
                      >
                        {attention ? 'Booking perlu review' : 'Tidak ada booking pending'}
                      </span>
                      {b.pending > 0 && (
                        <span className="whitespace-nowrap text-[11.5px] font-semibold" style={{ color: TINT.red.fg }}>
                          {b.pending} pending
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>

              {branch !== 'all' && branchActivity.data.items[0]?.barbers && branchActivity.data.items[0].barbers.length > 0 && (
                <div className="mt-5 border-t border-rb-divider pt-4">
                  <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-rb-text-muted">Roster & Status Barber ({branchActivity.data.items[0].name})</h3>
                  <div className="flex flex-col divide-y divide-rb-divider">
                    {branchActivity.data.items[0].barbers.map((b) => (
                      <div key={b.id} className="flex items-center justify-between py-2 text-xs">
                        <span className="font-medium text-rb-text">{b.name}</span>
                        <span>
                          {b.operational_status === 'off' || b.is_off ? (
                            <span className="rounded-rb-pill bg-rb-divider px-2 py-0.5 text-[10.5px] font-semibold text-rb-text-muted">OFF</span>
                          ) : b.operational_status === 'home_service' ? (
                            <span className="rounded-rb-pill bg-rb-teal-tint-bg px-2 py-0.5 text-[10.5px] font-semibold text-rb-teal-tint-fg">HOME SERVICE</span>
                          ) : b.operational_status === 'serving' ? (
                            <span className="rounded-rb-pill bg-rb-purple-tint-bg px-2 py-0.5 text-[10.5px] font-semibold text-rb-purple-tint-fg">SERVING</span>
                          ) : b.operational_status === 'available' ? (
                            <span className="rounded-rb-pill bg-rb-green-tint-bg px-2 py-0.5 text-[10.5px] font-semibold text-rb-green-tint-fg">AVAILABLE</span>
                          ) : b.operational_status === 'scheduled' ? (
                            <span className="rounded-rb-pill bg-rb-blue-tint-bg px-2 py-0.5 text-[10.5px] font-semibold text-rb-blue-tint-fg">SCHEDULED</span>
                          ) : b.operational_status === 'absent' ? (
                            <span className="rounded-rb-pill bg-rb-red-tint-bg px-2 py-0.5 text-[10.5px] font-semibold text-rb-red-tint-fg">ABSENT</span>
                          ) : (
                            <span className="rounded-rb-pill bg-rb-orange-tint-bg px-2 py-0.5 text-[10.5px] font-semibold text-rb-orange-tint-fg">BELUM CHECK-IN</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Action Center */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <h2 className="mb-3.5 font-serif text-[17px] font-semibold text-rb-text">Action Center</h2>
          {branchActivity.status === 'loading' && <LoadingState />}
          {branchActivity.status === 'error' && <ErrorState message={branchActivity.message} />}
          {branchActivity.status === 'ready' && (
            actionItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-rb-text-muted">Tidak ada tindakan mendesak saat ini.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {actionItems.map((item) => {
                  const t = TINT[item.tint];
                  return (
                    <div key={item.key} className="flex items-start gap-[11px] border-b border-rb-divider py-[11px] last:border-b-0">
                      <div
                        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg"
                        style={{ background: t.bg, color: t.fg }}
                      >
                        {item.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-semibold text-rb-text">{item.title}</div>
                        <div className="mt-0.5 text-xs text-rb-text-muted">{item.context}</div>
                      </div>
                      <Link to={item.href} className="pt-0.5 text-xs font-semibold whitespace-nowrap text-rb-red no-underline">
                        {item.cta} →
                      </Link>
                    </div>
                  );
                })}
              </div>
            )
          )}
          <p className="mt-4 text-[11.5px] text-rb-text-faint">
            Payroll dan Stockist belum terhubung ke Action Center — belum ada sumber data untuk domain tersebut.
          </p>
        </div>
      </div>

      {/* Business Snapshots */}
      <section className="mb-8">
        <h2 className="mt-1.5 mb-3.5 font-serif text-[17px] font-semibold text-rb-text">Business Snapshots</h2>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          <SnapshotCard
            title="Customer Snapshot"
            href="/crm"
            cta="Lihat CRM"
            accent={TINT.blue.fg}
            stats={
              segments.status === 'ready'
                ? [
                    { value: segments.data.kpis.new_customers, label: 'Baru' },
                    { value: segments.data.kpis.repeat_customers, label: 'Repeat' },
                  ]
                : undefined
            }
          />
          <SnapshotCard
            title="Membership Snapshot"
            href="/reports/membership"
            cta="Lihat Membership"
            accent={TINT.teal.fg}
            stats={
              membership.status === 'ready'
                ? [
                    { value: activeMembers ?? 0, label: membershipIsNetworkWide ? 'Member aktif (seluruh cabang)' : 'Member aktif' },
                    { value: activatedThisMonth ?? 0, label: membershipIsNetworkWide ? 'Baru bulan ini (seluruh cabang)' : 'Baru bulan ini' },
                  ]
                : undefined
            }
          />
          <SnapshotCard
            title="Branch Performance"
            href="/reports/branches"
            cta="Lihat Branch Performance"
            accent={TINT.red.fg}
            stats={
              topBranch
                ? [
                    { value: branchActivity.status === 'ready' ? branchActivity.data.items.length : 0, label: 'Cabang' },
                    { value: branchActivity.status === 'ready' ? branchActivity.data.items.reduce((sum, item) => sum + item.pending, 0) : 0, label: 'Booking pending' },
                  ]
                : undefined
            }
          />
          <SnapshotCard
            title="Barber Performance"
            href="/reports/barbers"
            cta="Lihat Barber"
            accent={TINT.orange.fg}
            stats={
              barberPerf.status === 'ready'
                ? [
                    { value: barberPerf.data.barbers.length, label: 'Kapster terukur' },
                    { value: topBarber ? topBarber.name : '—', label: 'Customer terbanyak' },
                  ]
                : undefined
            }
          />
          <SnapshotCard title="Inventory Snapshot" href="/stockist" cta="Lihat Inventory" accent={TINT.yellow.fg} unavailable />
          <SnapshotCard title="Payroll Snapshot" href="/payroll" cta="Lihat Payroll" accent={TINT.purple.fg} unavailable />
        </div>
      </section>
    </>
  );
}
