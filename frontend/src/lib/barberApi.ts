import type {
  BarberMeResponse,
  BarberStats,
  BarberUpcoming,
  BarberHistoryResponse,
  StreakData,
  AchievementsResponse,
  RecordsData,
  MissionsResponse,
  LeaderboardData,
  PaceData,
} from './barberTypes';

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Auth ────────────────────────────────────────────
export function sendBarberOTP(phone: string) {
  return jsonFetch<{ ok: true; barber: { id: string; name: string; branch: string } }>(
    '/api/barber/auth/otp/send',
    { method: 'POST', body: JSON.stringify({ phone }) }
  );
}

export function verifyBarberOTP(phone: string, code: string) {
  return jsonFetch<{ ok: true; setup_completed: boolean }>(
    '/api/barber/auth/otp/verify',
    { method: 'POST', body: JSON.stringify({ phone, code }) }
  );
}

export function logoutBarber() {
  return jsonFetch<{ ok: true }>('/api/barber/auth/logout', { method: 'POST' });
}

// ─── Profile ─────────────────────────────────────────
export function fetchBarberMe() {
  return jsonFetch<BarberMeResponse>('/api/barber/me');
}

export function saveBarberSetup(payload: {
  target_daily: number;
  target_monthly: number;
  avatar_url?: string;
}) {
  return jsonFetch<{ ok: true }>('/api/barber/setup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateBarberTarget(target_daily?: number, target_monthly?: number) {
  return jsonFetch<{ ok: true }>('/api/barber/target', {
    method: 'PUT',
    body: JSON.stringify({ target_daily, target_monthly }),
  });
}

export function uploadBarberAvatar(dataUrl: string) {
  return jsonFetch<{ ok: true; avatar_url: string }>('/api/barber/avatar/upload', {
    method: 'POST',
    body: JSON.stringify({ dataUrl }),
  });
}

// ─── Data ────────────────────────────────────────────
export function fetchBarberStats(period: BarberStats['period'] = 'day') {
  return jsonFetch<BarberStats>(`/api/barber/stats?period=${period}`);
}

export function fetchBarberUpcoming() {
  return jsonFetch<BarberUpcoming>('/api/barber/upcoming');
}

export function fetchBarberHistory(period: string = 'month', offset = 0, limit = 50) {
  return jsonFetch<BarberHistoryResponse>(
    `/api/barber/history?period=${period}&offset=${offset}&limit=${limit}`
  );
}

export function fetchBarberStreak() {
  return jsonFetch<StreakData>('/api/barber/streak');
}

export function fetchBarberAchievements() {
  return jsonFetch<AchievementsResponse>('/api/barber/achievements');
}

export function fetchBarberRecords() {
  return jsonFetch<RecordsData>('/api/barber/records');
}

export function fetchBarberMissions() {
  return jsonFetch<MissionsResponse>('/api/barber/missions');
}

export function fetchBarberLeaderboard() {
  return jsonFetch<LeaderboardData>('/api/barber/leaderboard');
}

export function fetchBarberFavorites() {
  return jsonFetch<{ favorites: Array<{ name: string; visits: number; service: string }> }>('/api/barber/favorites');
}

export function fetchBarberReviews() {
  return jsonFetch<{ reviews: Array<{ rating: number; review_text: string; customer_name: string; created_at: string }> }>('/api/barber/reviews');
}

export function fetchBarberPace() {
  return jsonFetch<PaceData>('/api/barber/pace');
}
