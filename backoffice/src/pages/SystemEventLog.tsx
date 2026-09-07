import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { apiClient } from '../lib/apiClient';

interface SystemEventLogRow {
  id: string;
  created_at: string;
  severity: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  module: string;
  event_name: string;
  status: string | null;
  entity_type: string | null;
  entity_id: string | null;
  message: string | null;
  correlation_id: string | null;
  request_id: string | null;
  error_code: string | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
}

interface Filters {
  module: string;
  severity: string;
  status: string;
  eventName: string;
  correlationId: string;
  bookingId: string;
  from: string;
  to: string;
}

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

const EMPTY_FILTERS: Filters = {
  module: '',
  severity: '',
  status: '',
  eventName: '',
  correlationId: '',
  bookingId: '',
  from: '',
  to: '',
};

const SEVERITY_BADGE: Record<string, string> = {
  CRITICAL: 'bg-rb-red-tint-fg text-white',
  ERROR: 'bg-rb-red-tint-bg text-rb-red-tint-fg',
  WARNING: 'bg-rb-orange-tint-bg text-rb-orange-tint-fg',
  INFO: 'bg-rb-blue-tint-bg text-rb-blue-tint-fg',
  DEBUG: 'bg-rb-bg text-rb-text-muted',
};

function buildQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.module) params.set('module', filters.module);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.status) params.set('status', filters.status);
  if (filters.eventName) params.set('eventName', filters.eventName);
  if (filters.correlationId) params.set('correlationId', filters.correlationId);
  if (filters.bookingId) params.set('bookingId', filters.bookingId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short' });
}

export function SystemEventLog() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [rowsState, setRowsState] = useState<LoadState<SystemEventLogRow[]>>({ status: 'loading' });
  const [selected, setSelected] = useState<SystemEventLogRow | null>(null);
  const [timelineState, setTimelineState] = useState<LoadState<SystemEventLogRow[]> | null>(null);

  useEffect(() => {
    setRowsState({ status: 'loading' });
    apiClient
      .get<{ data: SystemEventLogRow[] }>(`/api/internal/system-event-logs${buildQuery(filters)}`)
      .then((res) => setRowsState({ status: 'ready', data: res.data }))
      .catch(() => setRowsState({ status: 'error', message: 'Terjadi kesalahan memuat System Event Log.' }));
  }, [filters]);

  useEffect(() => {
    if (!selected?.correlation_id) {
      setTimelineState(null);
      return;
    }
    setTimelineState({ status: 'loading' });
    apiClient
      .get<{ data: SystemEventLogRow[] }>(`/api/internal/system-event-logs/timeline/${encodeURIComponent(selected.correlation_id)}`)
      .then((res) => setTimelineState({ status: 'ready', data: res.data }))
      .catch(() => setTimelineState({ status: 'error', message: 'Terjadi kesalahan memuat timeline.' }));
  }, [selected]);

  return (
    <>
      <PageHeader
        title="System Event Log"
        subtitle="Audit trail terpusat lintas booking, CRM, dan integrasi eksternal"
      />

      <div className="mb-5 grid grid-cols-2 gap-3 rounded-rb-card border border-rb-border bg-rb-surface p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <input
          placeholder="Module"
          value={filters.module}
          onChange={(e) => setFilters({ ...filters, module: e.target.value })}
          className="rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2 text-sm text-rb-text"
        />
        <select
          value={filters.severity}
          onChange={(e) => setFilters({ ...filters, severity: e.target.value })}
          className="rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2 text-sm text-rb-text"
        >
          <option value="">Semua severity</option>
          {['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          placeholder="Status"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2 text-sm text-rb-text"
        />
        <input
          placeholder="Event name"
          value={filters.eventName}
          onChange={(e) => setFilters({ ...filters, eventName: e.target.value })}
          className="rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2 text-sm text-rb-text"
        />
        <input
          placeholder="Correlation ID"
          value={filters.correlationId}
          onChange={(e) => setFilters({ ...filters, correlationId: e.target.value })}
          className="rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2 text-sm text-rb-text"
        />
        <input
          placeholder="Booking ID"
          value={filters.bookingId}
          onChange={(e) => setFilters({ ...filters, bookingId: e.target.value })}
          className="rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2 text-sm text-rb-text"
        />
        <label className="flex items-center gap-2 rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2 text-sm text-rb-text-muted">
          <span className="shrink-0 text-xs">From</span>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            className="w-full bg-transparent text-sm text-rb-text outline-none"
          />
        </label>
        <label className="flex items-center gap-2 rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2 text-sm text-rb-text-muted">
          <span className="shrink-0 text-xs">To</span>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            className="w-full bg-transparent text-sm text-rb-text outline-none"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="overflow-hidden rounded-rb-card border border-rb-border bg-rb-surface">
          <div className="border-b border-rb-divider px-4 py-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
            Events
          </div>

          {rowsState.status === 'loading' && <LoadingState label="Memuat event log..." />}
          {rowsState.status === 'error' && <ErrorState message={rowsState.message} />}
          {rowsState.status === 'ready' && rowsState.data.length === 0 && (
            <div className="p-4">
              <EmptyState
                title="No events found"
                description="Tidak ada event yang cocok dengan filter saat ini — coba ubah filter di atas."
              />
            </div>
          )}
          {rowsState.status === 'ready' && rowsState.data.length > 0 && (
            <div className="flex flex-col divide-y divide-rb-divider">
              {rowsState.data.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelected(row)}
                  className={`flex items-center justify-between gap-3 px-4 py-3 text-left text-sm ${selected?.id === row.id ? 'bg-rb-bg' : 'bg-rb-surface hover:bg-rb-bg'}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_BADGE[row.severity] ?? SEVERITY_BADGE.INFO}`}>
                        {row.severity}
                      </span>
                      <span className="truncate font-medium text-rb-text-secondary">{row.event_name}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-rb-text-muted">
                      {row.module} · {row.status ?? '-'} · {row.entity_type ? `${row.entity_type}:${row.entity_id}` : '-'} · {row.message || row.error_message || '-'}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-rb-text-muted">{formatTimestamp(row.created_at)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-4">
          <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Event Detail</h2>
          {!selected && (
            <p className="text-sm text-rb-text-muted">Pilih salah satu event untuk melihat detail dan timeline correlation-nya.</p>
          )}
          {selected && (
            <>
              <dl className="mb-4 flex flex-col gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-rb-text-muted">Correlation ID</dt>
                  <dd className="truncate text-right font-medium text-rb-text-secondary">{selected.correlation_id ?? '-'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-rb-text-muted">Request ID</dt>
                  <dd className="truncate text-right font-medium text-rb-text-secondary">{selected.request_id ?? '-'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-rb-text-muted">Entity</dt>
                  <dd className="truncate text-right font-medium text-rb-text-secondary">
                    {selected.entity_type ? `${selected.entity_type}:${selected.entity_id}` : '-'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-rb-text-muted">Error code</dt>
                  <dd className="truncate text-right font-medium text-rb-text-secondary">{selected.error_code ?? '-'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-rb-text-muted">Error message</dt>
                  <dd className="truncate text-right font-medium text-rb-text-secondary">{selected.error_message ?? '-'}</dd>
                </div>
                <div>
                  <dt className="mb-1 text-rb-text-muted">Metadata</dt>
                  <dd>
                    <pre className="max-h-40 overflow-auto rounded-rb-button bg-rb-bg p-2 text-xs text-rb-text-secondary">
                      {JSON.stringify(selected.metadata ?? {}, null, 2)}
                    </pre>
                  </dd>
                </div>
              </dl>

              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">Timeline</h3>
              {(!timelineState || timelineState.status === 'loading') && <LoadingState label="Memuat timeline..." />}
              {timelineState?.status === 'error' && <ErrorState message={timelineState.message} />}
              {timelineState?.status === 'ready' && (
                <ol className="flex flex-col gap-2 text-sm">
                  {timelineState.data.map((t) => (
                    <li key={t.id} className="flex items-center gap-2">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${SEVERITY_BADGE[t.severity] ?? SEVERITY_BADGE.INFO}`}>
                        {t.severity}
                      </span>
                      <span className="text-xs text-rb-text-muted">{new Date(t.created_at).toLocaleTimeString('id-ID')}</span>
                      <span className="truncate text-rb-text-secondary">{t.event_name} ({t.status ?? t.severity})</span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
