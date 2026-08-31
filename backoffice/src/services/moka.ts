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
