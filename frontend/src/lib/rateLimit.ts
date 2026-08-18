type Bucket = { count: number; start: number; windowMs: number };

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  req: { headers: Headers },
  { windowMs = 60_000, max = 10, name }: { windowMs?: number; max?: number; name: string }
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean).pop() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const key = `${name}:${ip}`;
  const now = Date.now();
  const record = buckets.get(key) ?? { count: 0, start: now, windowMs };

  if (now - record.start > windowMs) {
    record.count = 1;
    record.start = now;
  } else {
    record.count++;
  }
  record.windowMs = windowMs;
  buckets.set(key, record);

  if (record.count > max) {
    return { allowed: false, retryAfterMs: windowMs - (now - record.start) };
  }
  return { allowed: true };
}

const sweepInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of buckets.entries()) {
    if (now - record.start > record.windowMs * 2) buckets.delete(key);
  }
}, 5 * 60_000);
sweepInterval.unref?.();
