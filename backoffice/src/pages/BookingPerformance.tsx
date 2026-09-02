import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { LiveBadge } from '../components/LiveBadge';
import { getOwnerOverview, getCommandCenterForBranch, type CommandCenterBookingFeedItem } from '../services/crm';

interface BranchBookingRow {
  slug: string;
  name: string;
  totalBooking: number;
  confirmed: number;
  pending: number;
}

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      rows: BranchBookingRow[];
      totalBooking: number;
      totalConfirmed: number;
      totalPending: number;
      bookings: CommandCenterBookingFeedItem[];
      failedBranches: string[];
    };

function timeBucket(time: string): string {
  const hour = Number(time.split(':')[0]);
  if (Number.isNaN(hour)) return 'Tidak diketahui';
  if (hour < 11) return 'Pagi (< 11:00)';
  if (hour < 15) return 'Siang (11:00–15:00)';
  if (hour < 18) return 'Sore (15:00–18:00)';
  return 'Malam (≥ 18:00)';
}

export function BookingPerformance() {
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let overview;
      try {
        overview = await getOwnerOverview();
      } catch {
        if (!cancelled) setState({ status: 'error', message: 'Terjadi kesalahan memuat daftar cabang.' });
        return;
      }

      const results = await Promise.allSettled(overview.branches.map((b) => getCommandCenterForBranch(b.slug)));
      const rows: BranchBookingRow[] = [];
      const bookings: CommandCenterBookingFeedItem[] = [];
      let totalBooking = 0;
      let totalConfirmed = 0;
      let totalPending = 0;
      const failedBranches: string[] = [];

      results.forEach((result, i) => {
        const branch = overview.branches[i];
        if (result.status === 'rejected') {
          failedBranches.push(branch.name);
          return;
        }
        const data = result.value;
        const confirmed = data.booking_feed.filter((b) => b.status === 'confirmed').length;
        const pending = data.booking_feed.filter((b) => b.status === 'pending').length;

        rows.push({ slug: branch.slug, name: branch.name, totalBooking: data.stats.booking_today, confirmed, pending });
        bookings.push(...data.booking_feed);
        totalBooking += data.stats.booking_today;
        totalConfirmed += confirmed;
        totalPending += pending;
      });

      if (!cancelled) {
        setState({ status: 'ready', rows, totalBooking, totalConfirmed, totalPending, bookings, failedBranches });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const timePattern = state.status === 'ready'
    ? state.bookings.reduce<Record<string, number>>((acc, b) => {
        const bucket = timeBucket(b.time);
        acc[bucket] = (acc[bucket] ?? 0) + 1;
        return acc;
      }, {})
    : {};
  const timeBucketOrder = ['Pagi (< 11:00)', 'Siang (11:00–15:00)', 'Sore (15:00–18:00)', 'Malam (≥ 18:00)', 'Tidak diketahui'];

  return (
    <>
      <Link to="/reports" className="mb-2.5 inline-block text-sm font-semibold text-rb-text-muted">← Reports</Link>
      <PageHeader title="Booking Performance" subtitle="Analisis volume dan pola booking Redbox" />

      {state.status === 'loading' && <LoadingState label="Memuat data booking..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          {state.failedBranches.length > 0 && (
            <div className="mb-4 rounded-rb-button border border-rb-orange-tint-fg/30 bg-rb-orange-tint-bg px-4 py-2.5 text-sm text-rb-orange-tint-fg">
              Gagal memuat data untuk: {state.failedBranches.join(', ')}. Cabang lain tetap ditampilkan.
            </div>
          )}

          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard value={state.totalBooking} label="Total Booking" tint="red" />
            <StatCard value="—" label="Completed" trend="Belum tersedia" tint="green" />
            <StatCard value="—" label="Cancelled" trend="Belum tersedia" tint="orange" />
            <StatCard value={state.totalConfirmed} label="Upcoming / Confirmed" tint="blue" />
          </section>

          <div className="mb-6 rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-rb-divider px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-rb-text-muted">Booking per Cabang</span>
              <LiveBadge partial />
            </div>
            <div className="grid grid-cols-5 gap-2 border-b border-rb-divider px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
              <div>Cabang</div><div>Total Booking</div><div>Completed</div><div>Cancelled</div><div>Completion Rate</div>
            </div>
            <div className="flex flex-col divide-y divide-rb-divider">
              {state.rows.map((r) => (
                <div key={r.slug} className="grid grid-cols-5 items-center gap-2 px-4 py-3 text-sm">
                  <div className="font-semibold text-rb-text">{r.name}</div>
                  <div className="text-rb-text-secondary">{r.totalBooking}</div>
                  <div className="text-rb-text-faint">Belum tersedia</div>
                  <div className="text-rb-text-faint">Belum tersedia</div>
                  <div className="text-rb-text-faint">—</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-serif text-base font-semibold text-rb-text">Status Booking Hari Ini</h2>
                <LiveBadge partial />
              </div>
              <div className="flex flex-col divide-y divide-rb-divider">
                <div className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-medium text-rb-text-secondary">Menunggu Konfirmasi</span>
                  <span className="text-rb-text-muted">{state.totalPending}</span>
                </div>
                <div className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-medium text-rb-text-secondary">Terkonfirmasi</span>
                  <span className="text-rb-text-muted">{state.totalConfirmed}</span>
                </div>
              </div>
            </div>

            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-serif text-base font-semibold text-rb-text">Pola Waktu Booking</h2>
                <LiveBadge partial />
              </div>
              <div className="flex flex-col divide-y divide-rb-divider">
                {timeBucketOrder
                  .filter((bucket) => timePattern[bucket])
                  .map((bucket) => (
                    <div key={bucket} className="flex items-center justify-between py-2.5 text-sm">
                      <span className="font-medium text-rb-text-secondary">{bucket}</span>
                      <span className="text-rb-text-muted">{timePattern[bucket]}</span>
                    </div>
                  ))}
              </div>
              <p className="mt-4 text-[11.5px] text-rb-text-faint">
                Berdasarkan booking pending/confirmed hari ini — bukan data historis penuh.
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
