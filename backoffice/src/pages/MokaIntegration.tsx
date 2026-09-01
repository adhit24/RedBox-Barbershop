import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { getMokaStatus, getMokaSyncLogs, type MokaStatus, type MokaSyncLogEntry } from '../services/moka';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

const ENTITY_LABEL: Record<string, string> = {
  transaction: 'Transaction sync',
  item_mapping: 'Item mapping',
  customer: 'Customer sync',
  open_bill: 'Open bill sync',
};

export function MokaIntegration() {
  const [status, setStatus] = useState<LoadState<MokaStatus>>({ status: 'loading' });
  const [logs, setLogs] = useState<LoadState<MokaSyncLogEntry[]>>({ status: 'loading' });

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

  const connectedCount = status.status === 'ready' ? status.data.outlets.filter((o) => o.hasToken && !o.tokenExpired).length : 0;

  return (
    <>
      <PageHeader title="Moka POS Integration" subtitle="Status koneksi & sinkronisasi — Moka tetap menjadi sumber kebenaran transaksi" />

      {status.status === 'loading' && <LoadingState label="Memuat status Moka..." />}
      {status.status === 'error' && <ErrorState message={status.message} />}

      {status.status === 'ready' && (
        <>
          <div className="mb-5 flex items-center justify-between rounded-rb-card border border-rb-border bg-rb-surface p-5">
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${status.data.oauthConfigured ? 'bg-rb-green-tint-fg' : 'bg-rb-red-tint-fg'}`} />
              <div>
                <div className="text-[15px] font-semibold text-rb-text">{status.data.oauthConfigured ? 'Connected' : 'Not Configured'}</div>
                <div className="text-xs text-rb-text-muted">OAuth {status.data.oauthConfigured ? 'aktif' : 'belum dikonfigurasi'} · terhubung ke {connectedCount}/{status.data.outlets.length} outlet Moka</div>
              </div>
            </div>
          </div>

          <div className="mb-5 rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
            <div className="border-b border-rb-divider px-4 py-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
              Status Outlet
            </div>
            <div className="flex flex-col divide-y divide-rb-divider">
              {status.data.outlets.map((o) => (
                <div key={o.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="font-medium text-rb-text-secondary">{o.name}</span>
                  <span className={o.tokenExpired ? 'text-rb-red-tint-fg' : o.hasToken ? 'text-rb-green-tint-fg' : 'text-rb-text-muted'}>
                    {o.hasToken ? (o.tokenExpired ? 'Token kedaluwarsa' : 'Terhubung') : 'Belum terhubung'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
        <div className="border-b border-rb-divider px-4 py-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
          Sync Logs
        </div>
        {logs.status === 'loading' && <LoadingState label="Memuat sync logs..." />}
        {logs.status === 'error' && <ErrorState message={logs.message} />}
        {logs.status === 'ready' && (
          <div className="flex flex-col divide-y divide-rb-divider">
            {logs.data.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${l.status === 'ok' ? 'bg-rb-green-tint-fg' : 'bg-rb-red-tint-fg'}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-rb-text-secondary">
                    {ENTITY_LABEL[l.entity_type] ?? l.entity_type} — {l.direction} {l.status === 'ok' ? 'berhasil' : 'gagal'}
                  </div>
                  {l.error_message && <div className="truncate text-xs text-rb-text-muted">{l.error_message}</div>}
                </div>
                <span className="shrink-0 text-xs text-rb-text-muted">{new Date(l.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
