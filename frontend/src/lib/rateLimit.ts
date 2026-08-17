type Bucket = { count: number; start: number };

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  req: { headers: Headers },
  { windowMs = 60_000, max = 10, name }: { windowMs?: number; max?: number; name: string }
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const key = `${name}:${ip}`;
  const now = Date.now();
  const record = buckets.get(key) ?? { count: 0, start: now };

  if (now - record.start > windowMs) {
    record.count = 1;
    record.start = now;
  } else {
    record.count++;
  }
  buckets.set(key, record);

  if (record.count > max) {
    return { allowed: false, retryAfterMs: windowMs - (now - record.start) };
  }
  return { allowed: true };
}
