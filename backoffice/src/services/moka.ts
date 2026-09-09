import { apiClient } from '../lib/apiClient';

export interface MokaOutletStatus {
  id: string;
  name: string;
  slug: string;
  mokaOutletId: string | null;
  hasToken: boolean;
  tokenExpiry: string | null;
  tokenExpired: boolean | null;
}

export interface MokaSyncLog {
  direction: string;
  status: string;
  created_at: string;
  error_message: string | null;
}

export interface MokaStatus {
  oauthConfigured: boolean;
  outlets: MokaOutletStatus[];
  recentLogs: MokaSyncLog[];
}

export function getMokaStatus(): Promise<MokaStatus> {
  return apiClient.get<MokaStatus>('/api/moka/status');
}

export interface MokaSyncLogEntry {
  id: string;
  direction: string;
  entity_type: string;
  entity_id: string | null;
  status: string;
  error_message: string | null;
  retry_count: number;
  created_at: string;
}

export function getMokaSyncLogs(params: { limit?: number; direction?: string; status?: string }): Promise<{ logs: MokaSyncLogEntry[] }> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.direction) query.set('direction', params.direction);
  if (params.status) query.set('status', params.status);
  const qs = query.toString();
  return apiClient.get<{ logs: MokaSyncLogEntry[] }>(`/api/moka/sync-logs${qs ? `?${qs}` : ''}`);
}

export type MokaBranchHealthState =
  | 'HEALTHY'
  | 'PARTIAL'
  | 'DELAYED'
  | 'TOKEN_EXPIRED'
  | 'NOT_CONFIGURED'
  | 'ERROR';

export interface MokaBranchHealthStats {
  fetched: number;
  unmapped: number;
  anomalies: number;
  processed: number;
  qtyDeducted: number;
  skippedDuplicate: number;
}

export interface MokaBranchHealth {
  outletId: string;
  name: string;
  slug: string;
  mokaOutletId: string | null;
  hasToken: boolean;
  tokenExpiresAt: string | null;
  tokenExpired: boolean;
  lastSuccessfulSyncAt: string | null;
  lastStartedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  healthState: MokaBranchHealthState;
  attentionReason: string | null;
  stats: MokaBranchHealthStats | null;
}

export function getMokaBranchHealth(): Promise<{ branches: MokaBranchHealth[] }> {
  return apiClient.get<{ branches: MokaBranchHealth[] }>('/api/moka/branch-health');
}
