const BACKEND_TIMEOUT_MS = 10_000;

export async function proxyFetch(url: string, init?: RequestInit) {
  const signal = AbortSignal.timeout(BACKEND_TIMEOUT_MS);
  const res = await fetch(url, { signal, ...init });
  const json = await res.json().catch(() => ({ error: 'invalid response' }));
  return { json, status: res.status };
}
