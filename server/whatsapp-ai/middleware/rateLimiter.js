const config = require('../config');

// Simple in-memory rate limiter per sender phone
const requestMap = new Map(); // phone → { count, windowStart }

const rateLimiter = (req, res, next) => {
  // Extract phone from WhatsApp payload
  const phone = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;

  if (!phone) return next(); // Pass through if no phone (e.g. status updates)

  const now = Date.now();
  const record = requestMap.get(phone) || { count: 0, windowStart: now };

  // Reset window if expired
  if (now - record.windowStart > config.RATE_LIMIT_WINDOW_MS) {
    record.count = 0;
    record.windowStart = now;
  }

  record.count++;
  requestMap.set(phone, record);

  if (record.count > config.RATE_LIMIT_MAX) {
    console.warn(`[RateLimit] Blocked: ${phone} (${record.count} reqs in window)`);
    // Still return 200 to Meta but don't process
    return res.status(200).send('EVENT_RECEIVED');
  }

  next();
};

module.exports = { rateLimiter };
