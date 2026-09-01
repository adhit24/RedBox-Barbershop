import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { getCustomer360, type Customer360 as Customer360Data } from '../services/crm';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: Customer360Data };

function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

// :id is the opaque customer_key produced by /customer-segments (e.g. "phone:6281...")
// — a canonical grouping key, not a `customers.id` UUID. It maps to getCustomer360's
// `phone` lookup param when the key is phone-based, or `customer_id` otherwise.
export function Customer360() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!id) return;
    const decoded = decodeURIComponent(id);
    const params = decoded.startsWith('phone:')
      ? { phone: decoded.slice('phone:'.length) }
      : { customer_id: decoded };
    getCustomer360(params)
      .then((data) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'error', message: 'Terjadi kesalahan memuat profil pelanggan.' }));
  }, [id]);

  if (state.status === 'loading') return <LoadingState label="Memuat profil pelanggan..." />;
  if (state.status === 'error') return <ErrorState message={state.message} />;

  if (!state.data.identity.customer_found) {
    return <EmptyState title="Pelanggan tidak ditemukan" description="Identitas pelanggan ini tidak dapat diselesaikan dari data yang tersedia." />;
  }

  const { customer, membership, loyalty, activity, spending, preferences } = state.data;

  return (
    <>
      <div className="mb-4 text-sm text-rb-text-muted">
        <Link to="/crm" className="font-medium text-rb-text-muted">CRM &amp; Customer</Link>
        <span className="mx-1.5">›</span>
        <span className="font-semibold text-rb-text">{customer?.name ?? 'Pelanggan'}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <h1 className="font-serif text-xl font-semibold text-rb-text">{customer?.name ?? 'Tidak diketahui'}</h1>
          <div className="mt-1 mb-3 text-xs text-rb-text-muted">{customer?.wa_number ?? '—'}</div>
          {membership?.tier && (
            <span className="rounded-rb-pill bg-rb-purple-tint-bg px-2.5 py-1 text-xs font-semibold text-rb-purple-tint-fg">
              Member {membership.tier}
            </span>
          )}
          <div className="my-4 h-px bg-rb-divider" />
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between"><span className="text-rb-text-muted">Total Visit</span><span className="font-semibold text-rb-text">{activity?.completed_booking_count ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-rb-text-muted">Last Visit</span><span className="font-semibold text-rb-text">{activity?.last_visit ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-rb-text-muted">Cabang Favorit</span><span className="font-semibold text-rb-text">{preferences?.favorite_branch?.value ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-rb-text-muted">Barber Favorit</span><span className="font-semibold text-rb-text">{preferences?.favorite_barber?.value ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-rb-text-muted">Layanan Favorit</span><span className="font-semibold text-rb-text">{preferences?.favorite_service?.value ?? '—'}</span></div>
            {loyalty?.points_balance !== null && loyalty?.points_balance !== undefined && (
              <div className="flex justify-between"><span className="text-rb-text-muted">Poin</span><span className="font-semibold text-rb-text">{loyalty.points_balance}</span></div>
            )}
            {spending && (
              <div className="flex justify-between"><span className="text-rb-text-muted">Total Belanja</span><span className="font-semibold text-rb-text">{formatRupiah(spending.total_spend_idr)}</span></div>
            )}
          </div>
        </div>

        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 text-sm font-semibold text-rb-text-muted">Ringkasan Kunjungan Terakhir</div>
          {activity?.last_visit ? (
            <div className="flex items-center justify-between border-b border-rb-divider py-3 text-sm">
              <div>
                <div className="font-semibold text-rb-text">{activity.last_visit_service ?? '—'}</div>
                <div className="text-xs text-rb-text-muted">{activity.last_visit_branch ?? '—'} · {activity.last_visit_barber ?? '—'}</div>
              </div>
              <div className="text-right text-rb-text-secondary">{activity.last_visit}</div>
            </div>
          ) : (
            <EmptyState title="Belum ada kunjungan" description="Tidak ada riwayat kunjungan selesai untuk pelanggan ini." />
          )}
        </div>
      </div>
    </>
  );
}
