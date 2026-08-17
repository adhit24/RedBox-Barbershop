const buckets = new Map();

function rateLimit({ windowMs = 60000, max = 10, name } = {}) {
  if (!name) throw new Error('rateLimit requires a unique `name` so routes do not share buckets');
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const key = `${name}:${ip}`;
    const record = buckets.get(key) || { count: 0, start: now };

    if (now - record.start > windowMs) {
      record.count = 1;
      record.start = now;
    } else {
      record.count++;
    }
    buckets.set(key, record);

    if (record.count > max) {
      return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi dalam beberapa saat.' });
    }
    next();
  };
}

module.exports = { rateLimit };
