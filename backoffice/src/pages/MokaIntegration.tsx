import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import {
  BoxIcon,
  CheckIcon,
  MemberIcon,
  RepeatIcon,
  WalletClockIcon,
} from '../components/icons';
import {
  getMokaStatus,
  getMokaSyncLogs,
  getMokaHealth,
  postSyncTransactions,
  type MokaStatus,
  type MokaSyncLogEntry,
  type MokaHealthResult,
  type MokaOutletHealthStatus,
} from '../services/moka';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

const OPERATIONAL_TIMEZONE = 'Asia/Jakarta';

// Real entity_type values written by server/moka/sync.js's sync_logs writers —
// see that file's _startLog/_finishLog call sites. There is no logged entity
// type for customer sync, item mapping, or barber mapping today (those
// operations don't write to sync_logs), so those cards stay honestly
// "Belum tersedia" rather than being mapped to a fictional entity type.
const ENTITY_LABEL: Record<string, string> = {
  order: 'Transaction sync',
  schedule: 'Booking push',
  checkout: 'Checkout push',
  moka_open_bills: 'Open bill sync',
};

const HEALTH_LABEL: Record<MokaOutletHealthStatus, string> = {
  healthy: 'Healthy',
  expired: 'Expired',
  missing_token: 'Missing Token',
  sync_error: 'Sync Error',
};

const HEALTH_TINT: Record<MokaOutletHealthStatus, string> = {
  healthy: 'bg-rb-green-tint-bg text-rb-green-tint-fg',
  expired: 'bg-rb-red-tint-bg text-rb-red-tint-fg',
  missing_token: 'bg-rb-orange-tint-bg text-rb-orange-tint-fg',
  sync_error: 'bg-rb-red-tint-bg text-rb-red-tint-fg',
};

function formatClock(value: string) {
  return new Date(value).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: OPERATIONAL_TIMEZONE,
  });
}

function statusBadge(status: 'active' | 'attention' | 'delayed' | 'unavailable') {
  const classes = {
    active: 'bg-rb-green-tint-bg text-rb-green-tint-fg',
    attention: 'bg-rb-orange-tint-bg text-rb-orange-tint-fg',
    delayed: 'bg-rb-red-tint-bg text-rb-red-tint-fg',
    unavailable: 'bg-rb-bg text-rb-text-muted',
  };
  const labels = {
    active: 'Aktif',
    attention: 'Perlu Perhatian',
    delayed: 'Delayed',
    unavailable: 'Belum tersedia',
  };

  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${classes[status]}`}>
      {labels[status]}
    </span>
  );
}

interface SyncCardProps {
  icon: React.ReactNode;
  title: string;
  detail: string;
  status: 'active' | 'attention' | 'delayed' | 'unavailable';
}

function SyncCard({ icon, title, detail, status }: SyncCardProps) {
  return (
    <div className="flex min-h-[78px] items-center justify-between gap-4 rounded-rb-card border border-rb-border bg-rb-surface px-5 py-4">
      <div className="flex min-w-0 items-center gap-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-rb-bg text-rb-text-secondary">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-rb-text">{title}</div>
          <div className="mt-1 truncate text-xs text-rb-text-muted">{detail}</div>
        </div>
      </div>
      {statusBadge(status)}
    </div>
  );
}

export function MokaIntegration() {
  const [status, setStatus] = useState<LoadState<MokaStatus>>({ status: 'loading' });
  const [logs, setLogs] = useState<LoadState<MokaSyncLogEntry[]>>({ status: 'loading' });
  const [health, setHealth] = useState<LoadState<MokaHealthResult>>({ status: 'loading' });
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    getMokaStatus()
      .then((data) => setStatus({ status: 'ready', data }))
      .catch(() => setStatus({ status: 'error', message: 'Terjadi kesalahan memuat status Moka.' }));
  }, []);

  useEffect(() => {
    getMokaSyncLogs({ limit: 20 })
      .then((data) => setLogs({ status: 'ready', data: data.logs }))
      .catch(() => setLogs({ status: 'error', message: 'Terjadi kesalahan memuat sync logs.' }));
  }, []);

  useEffect(() => {
    getMokaHealth()
      .then((data) => setHealth({ status: 'ready', data }))
      .catch(() => setHealth({ status: 'error', message: 'Terjadi kesalahan memuat health status.' }));
  }, []);

  const connectedCount = status.status === 'ready'
    ? status.data.outlets.filter((o) => o.hasToken && !o.tokenExpired).length
    : 0;

  const summaries = useMemo(() => {
    const entries = logs.status === 'ready' ? logs.data : [];
    const latest = (entity: string) => entries.find((entry) => entry.entity_type === entity);
    const latestOk = entries.find((entry) => entry.status === 'success');

    return {
      order: latest('order'),
      openBill: latest('moka_open_bills'),
      latestOk,
    };
  }, [logs]);

  const describeLog = (entry: MokaSyncLogEntry | undefined, emptyText: string) => {
    if (!entry) return emptyText;
    if (entry.error_message) return entry.error_message;
    return `Sinkron terakhir ${formatClock(entry.created_at)}`;
  };

  const syncStatus = (entry: MokaSyncLogEntry | undefined, missing: 'unavailable' | 'attention' = 'unavailable') => {
    if (!entry) return missing;
    return entry.status === 'success' ? 'active' : 'attention';
  };

  async function handleSyncNow() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await postSyncTransactions();
      const totalProcessed = result.results.reduce((sum, r) => sum + (r.processed ?? 0), 0);
      setSyncMessage(`Sinkron selesai — ${totalProcessed} transaksi diproses.`);
      getMokaHealth().then((data) => setHealth({ status: 'ready', data })).catch(() => {});
      getMokaSyncLogs({ limit: 20 }).then((data) => setLogs({ status: 'ready', data: data.logs })).catch(() => {});
    } catch {
      setSyncMessage('Sinkronisasi gagal dijalankan. Coba lagi beberapa saat lagi.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Moka POS Integration"
        subtitle="Status koneksi & sinkronisasi — Moka tetap menjadi sumber kebenaran transaksi"
        actions={
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={syncing}
            className="rounded-rb-button bg-rb-red px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {syncing ? 'Menyinkronkan...' : 'Sync Now'}
          </button>
        }
      />
      {syncMessage && (
        <div className="mb-5 rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2.5 text-sm text-rb-text-secondary">
          {syncMessage}
        </div>
      )}

      {status.status === 'loading' && <LoadingState label="Memuat status Moka..." />}
      {status.status === 'error' && <ErrorState message={status.message} />}

      {status.status === 'ready' && (
        <>
          <div className="mb-5 flex min-h-[76px] items-center justify-between gap-4 rounded-rb-card border border-rb-border bg-rb-surface px-5 py-4">
            <div className="flex items-center gap-3.5">
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 rounded-full ${status.data.oauthConfigured ? 'bg-rb-green-tint-fg' : 'bg-rb-red-tint-fg'}`}
              />
              <div>
                <div className="text-[15px] font-semibold text-rb-text">
                  {status.data.oauthConfigured ? 'Connected' : 'Not Configured'}
                </div>
                <div className="mt-0.5 text-xs text-rb-text-muted">
                  OAuth {status.data.oauthConfigured ? 'aktif' : 'belum dikonfigurasi'} · terhubung ke {connectedCount}/{status.data.outlets.length} outlet Moka
                </div>
              </div>
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
            <SyncCard
              icon={<RepeatIcon size={18} stroke="currentColor" />}
              title="Transaction Sync"
              detail={summaries.order
                ? `${describeLog(summaries.order, 'Belum ada transaksi tersinkron')} · ${connectedCount}/${status.data.outlets.length} outlet`
                : 'Belum ada transaksi tersinkron'}
              status={syncStatus(summaries.order)}
            />
            <SyncCard
              icon={<MemberIcon size={18} stroke="currentColor" />}
              title="Customer Sync"
              detail="Belum ada data customer sync"
              status="unavailable"
            />
            <SyncCard
              icon={<BoxIcon size={18} stroke="currentColor" />}
              title="Item Mapping"
              detail="Belum ada data item mapping"
              status="unavailable"
            />
            <SyncCard
              icon={<MemberIcon size={18} stroke="currentColor" />}
              title="Barber Mapping"
              detail="Data barber mapping belum tersedia"
              status="unavailable"
            />
            <SyncCard
              icon={<WalletClockIcon size={18} stroke="currentColor" />}
              title="Open Bill / Schedule Sync"
              detail={describeLog(summaries.openBill, 'Belum ada data open bill / schedule sync')}
              status={syncStatus(summaries.openBill, 'unavailable')}
            />
            <SyncCard
              icon={<CheckIcon size={18} stroke="currentColor" />}
              title="Last Successful Sync"
              detail={summaries.latestOk ? `${formatClock(summaries.latestOk.created_at)} · ${ENTITY_LABEL[summaries.latestOk.entity_type] ?? summaries.latestOk.entity_type}` : 'Belum ada sync berhasil'}
              status={summaries.latestOk ? 'active' : 'unavailable'}
            />
          </div>
        </>
      )}

      {/* Health Status per Cabang */}
      <div className="mb-5 overflow-hidden rounded-rb-card border border-rb-border bg-rb-surface">
        <div className="border-b border-rb-divider px-5 py-3.5 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
          Health Status per Cabang
        </div>
        {health.status === 'loading' && <LoadingState label="Memuat health status..." />}
        {health.status === 'error' && <ErrorState message={health.message} />}
        {health.status === 'ready' && (
          <div className="flex flex-col divide-y divide-rb-divider">
            {health.data.outlets.map((o) => (
              <div key={o.outletId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm">
                <div className="min-w-0">
                  <div className="font-semibold text-rb-text">{o.name}</div>
                  <div className="mt-0.5 text-xs text-rb-text-muted">
                    {o.lastSuccessfulSync ? `Sync terakhir ${formatClock(o.lastSuccessfulSync)}` : 'Belum pernah sync'}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-rb-text-muted">
                  <span>{o.transactionsToday} transaksi hari ini</span>
                  {o.unmatchedTransactionsToday > 0 && (
                    <span className="rounded-rb-pill bg-rb-orange-tint-bg px-2 py-0.5 font-semibold text-rb-orange-tint-fg">
                      {o.unmatchedTransactionsToday} belum matched
                    </span>
                  )}
                  <span className={`rounded-rb-pill px-2.5 py-1 font-semibold ${HEALTH_TINT[o.health]}`}>
                    {HEALTH_LABEL[o.health]}
                  </span>
                </div>
              </div>
            ))}
            {health.data.outlets.length === 0 && (
              <div className="px-5 py-8 text-center text-sm text-rb-text-muted">Belum ada cabang terkonfigurasi.</div>
            )}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-rb-card border border-rb-border bg-rb-surface">
        <div className="border-b border-rb-divider px-5 py-3.5 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
          Sync Logs
        </div>
        {logs.status === 'loading' && <LoadingState label="Memuat sync logs..." />}
        {logs.status === 'error' && <ErrorState message={logs.message} />}
        {logs.status === 'ready' && (
          <div className="flex flex-col divide-y divide-rb-divider">
            {logs.data.map((entry) => {
              const isOk = entry.status === 'success';
              return (
                <div key={entry.id} className="flex min-h-[54px] items-center gap-3 px-5 py-3 text-sm">
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${isOk ? 'bg-rb-green-tint-fg' : entry.retry_count > 0 ? 'bg-rb-orange-tint-fg' : 'bg-rb-red-tint-fg'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-rb-text-secondary">
                      {ENTITY_LABEL[entry.entity_type] ?? entry.entity_type} — {entry.direction} {isOk ? 'berhasil' : 'gagal'}
                    </div>
                    <div className="truncate text-xs text-rb-text-muted">
                      {entry.error_message ?? (entry.entity_id ? `ID ${entry.entity_id}` : 'Sinkronisasi tercatat')}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-rb-text-muted">{formatClock(entry.created_at)}</span>
                </div>
              );
            })}
            {logs.data.length === 0 && (
              <div className="px-5 py-8 text-center text-sm text-rb-text-muted">Belum ada sync log.</div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
