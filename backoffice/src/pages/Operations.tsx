import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { LiveBadge } from '../components/LiveBadge';
import {
  getOwnerOverview,
  getCommandCenterForBranch,
  type CommandCenterBookingFeedItem,
  type CommandCenterBarber,
} from '../services/crm';

interface MergedBooking extends CommandCenterBookingFeedItem {
  branchName: string;
  barberName: string;
}

interface MergedBarber extends CommandCenterBarber {
  branchName: string;
}

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      bookings: MergedBooking[];
      barbers: MergedBarber[];
      bookingTodayTotal: number;
      failedBranches: string[];
    };

export function Operations() {
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

      const results = await Promise.allSettled(
        overview.branches.map((b) => getCommandCenterForBranch(b.slug))
      );

      const bookings: MergedBooking[] = [];
      const barbers: MergedBarber[] = [];
      let bookingTodayTotal = 0;
      const failedBranches: string[] = [];

      results.forEach((result, i) => {
        const branch = overview.branches[i];
        if (result.status === 'rejected') {
          failedBranches.push(branch.name);
          return;
        }
        const data = result.value;
        bookingTodayTotal += data.stats.booking_today;

        const barberNameMap = new Map(data.barbers.map((b) => [b.id, b.name]));
        for (const booking of data.booking_feed) {
          bookings.push({
            ...booking,
            branchName: branch.name,
            barberName: (booking.barber_id && barberNameMap.get(booking.barber_id)) || '—',
          });
        }
        for (const barber of data.barbers) {
          barbers.push({ ...barber, branchName: branch.name });
        }
      });

      bookings.sort((a, b) => a.time.localeCompare(b.time));

      if (!cancelled) {
        setState({ status: 'ready', bookings, barbers, bookingTodayTotal, failedBranches });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Operations"
        subtitle="Aktivitas booking dan barber lintas cabang, hari ini"
      />

      {state.status === 'loading' && <LoadingState label="Memuat data operasional..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          {state.failedBranches.length > 0 && (
            <div className="mb-4 rounded-rb-button border border-rb-orange-tint-fg/30 bg-rb-orange-tint-bg px-4 py-2.5 text-sm text-rb-orange-tint-fg">
              Gagal memuat data untuk: {state.failedBranches.join(', ')}. Cabang lain tetap ditampilkan.
            </div>
          )}

          <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard value={state.bookingTodayTotal} label="Booking Hari Ini" tint="red" />
            <StatCard value={state.bookings.length} label="Menunggu / Perlu Aksi" tint="purple" />
            <StatCard value={state.barbers.filter((b) => b.attendance_status === 'hadir' || b.attendance_status === 'terlambat').length} label="Barber Hadir" tint="green" />
            <StatCard value={state.barbers.filter((b) => !b.attendance_status).length} label="Belum Check-in" tint="orange" />
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-serif text-base font-semibold text-rb-text">Booking Hari Ini</h2>
                <LiveBadge partial />
              </div>
              {state.bookings.length === 0 && (
                <p className="py-6 text-center text-sm text-rb-text-muted">Tidak ada booking pending/confirmed saat ini.</p>
              )}
              <div className="flex flex-col divide-y divide-rb-divider">
                {state.bookings.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="w-12 shrink-0 text-rb-text-muted">{b.time}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-rb-text-secondary">{b.name}</div>
                      <div className="truncate text-xs text-rb-text-muted">{b.service} · {b.branchName} · {b.barberName}</div>
                    </div>
                    <span className="shrink-0 rounded-rb-pill bg-rb-blue-tint-bg px-2.5 py-1 text-[11px] font-semibold text-rb-blue-tint-fg">
                      {b.status === 'pending' ? 'Menunggu Konfirmasi' : 'Terkonfirmasi'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-serif text-base font-semibold text-rb-text">Barber On Duty</h2>
                <LiveBadge />
              </div>
              <div className="flex flex-col divide-y divide-rb-divider">
                {state.barbers.map((b) => (
                  <div key={`${b.branchName}-${b.id}`} className="flex items-center justify-between py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-rb-text-secondary">{b.name}</div>
                      <div className="text-xs text-rb-text-muted">{b.branchName}</div>
                    </div>
                    <span className="shrink-0 text-xs text-rb-text-muted">{b.attendance_status ?? 'Belum check-in'}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[11.5px] text-rb-text-faint">
                Moka tetap menjadi sumber kebenaran transaksional untuk seluruh booking.
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
