// TEMPORARY COMPATIBILITY AUTH — see docs/superpowers/specs/2026-08-31-redbox-backoffice-command-center-design.md §12a.
// Attaches the shared admin token to every request. On 401, notifies subscribers
// (AuthProvider) so the app can clear the session and redirect to /login, without
// this module needing to import AuthProvider directly.

const TOKEN_STORAGE_KEY = 'redbox_backoffice_admin_token';

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // sessionStorage unavailable (e.g. private browsing edge case) — session
    // simply won't persist across reloads; login still works for this page view.
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // no-op
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('x-admin-token', token);

  const res = await fetch(path, { ...init, headers });

  if (res.status === 401) {
    unauthorizedListeners.forEach((listener) => listener());
    throw new ApiError(401, 'Unauthorized');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body || `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
};

/**
 * Validates a password against the existing production admin gate by calling an
 * already-authenticated endpoint. There is no dedicated login endpoint — the
 * password itself is the token (see server/index.js adminAuth middleware).
 */
export async function validateAdminToken(candidateToken: string): Promise<boolean> {
  const res = await fetch('/api/admin/crm/command-center', {
    method: 'GET',
    headers: { 'x-admin-token': candidateToken },
  });
  if (res.status === 401) return false;
  if (!res.ok) throw new ApiError(res.status, 'Server tidak merespons, coba lagi.');
  return true;
}
