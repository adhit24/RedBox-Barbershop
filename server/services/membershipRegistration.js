'use strict';

const TIER_PRICES = Object.freeze({
  silver: 100000,
  gold: 250000,
  platinum: 1500000,
});

const PAYMENT_METHODS = new Set(['cash', 'qris', 'transfer']);
const PENDING_REGISTRATION_DAYS = 7;
const MEMBERSHIP_REGISTRATION_RATE_LIMIT = Object.freeze({
  windowMs: 60_000,
  maxPerIp: 10,
  maxPerPhone: 3,
});

function asDate(value, name) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${name} must be a valid date`);
  return date;
}

function getTierPrice(tier) {
  if (!Object.prototype.hasOwnProperty.call(TIER_PRICES, tier)) {
    throw new Error('invalid tier');
  }
  return TIER_PRICES[tier];
}

function normalizePhone(phone) {
  const raw = String(phone ?? '').trim();
  if (!raw) throw new Error('phone is required');
  if (!/^\+?[0-9\s()./-]+$/.test(raw)) {
    throw new Error('invalid Indonesian mobile phone');
  }

  const digits = raw.replace(/\D/g, '');
  let canonical;
  if (raw.startsWith('+')) {
    if (!digits.startsWith('62')) throw new Error('invalid Indonesian mobile phone');
    canonical = `+${digits}`;
  } else if (digits.startsWith('62')) {
    canonical = `+${digits}`;
  } else if (digits.startsWith('0')) {
    canonical = `+62${digits.slice(1)}`;
  } else if (digits.startsWith('8')) {
    canonical = `+62${digits}`;
  } else {
    throw new Error('invalid Indonesian mobile phone');
  }

  // Indonesian mobile numbers are 10-13 digits in their domestic 08... form.
  if (!/^\+628[1-9]\d{7,10}$/.test(canonical)) {
    throw new Error('invalid Indonesian mobile phone');
  }
  return canonical;
}

function requestIp(req) {
  return req.ip
    || req.socket?.remoteAddress
    || 'unknown';
}

function createFixedWindowRateLimiter({ windowMs, max, keyFor, message, now = Date.now }) {
  const records = new Map();
  let lastCleanup = now();

  return (req, res, next) => {
    const timestamp = now();
    if (timestamp - lastCleanup >= windowMs) {
      for (const [key, record] of records.entries()) {
        if (timestamp - record.start >= windowMs) records.delete(key);
      }
      lastCleanup = timestamp;
    }

    const key = keyFor(req);
    if (!key) return next();
    const record = records.get(key) || { count: 0, start: timestamp };
    if (timestamp - record.start >= windowMs) {
      record.count = 1;
      record.start = timestamp;
    } else {
      record.count += 1;
    }
    records.set(key, record);

    if (record.count > max) {
      const retryAfter = Math.max(1, Math.ceil((record.start + windowMs - timestamp) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message, retryAfter });
    }
    return next();
  };
}

function createMembershipRegistrationRateLimiters(options = {}) {
  const windowMs = options.windowMs ?? MEMBERSHIP_REGISTRATION_RATE_LIMIT.windowMs;
  const maxPerIp = options.maxPerIp ?? MEMBERSHIP_REGISTRATION_RATE_LIMIT.maxPerIp;
  const maxPerPhone = options.maxPerPhone ?? MEMBERSHIP_REGISTRATION_RATE_LIMIT.maxPerPhone;
  const now = options.now || Date.now;

  return [
    createFixedWindowRateLimiter({
      windowMs,
      max: maxPerIp,
      now,
      keyFor: (req) => `membership-registration:ip:${requestIp(req)}`,
      message: 'Terlalu banyak permintaan pendaftaran dari jaringan ini. Coba lagi nanti.',
    }),
    createFixedWindowRateLimiter({
      windowMs,
      max: maxPerPhone,
      now,
      keyFor: (req) => {
        try {
          return `membership-registration:phone:${normalizePhone(req.body?.phone)}`;
        } catch (_) {
          return null;
        }
      },
      message: 'Terlalu banyak permintaan pendaftaran untuk nomor ini. Coba lagi nanti.',
    }),
  ];
}

function makePendingRegistration({ now = new Date(), ...customer } = {}) {
  const createdAt = asDate(now, 'now');
  const expiresAt = new Date(createdAt.getTime());
  expiresAt.setUTCDate(expiresAt.getUTCDate() + PENDING_REGISTRATION_DAYS);
  const priceSnapshot = getTierPrice(customer.tier);

  return {
    ...customer,
    phone: normalizePhone(customer.phone),
    priceSnapshot,
    status: 'PENDING',
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

function toPublicRegistration(registration) {
  return {
    registrationId: registration.registrationId || registration.registration_id || registration.id,
    registrationCode: registration.registrationCode || registration.registration_code,
    tier: registration.tier,
    amount: registration.amount ?? registration.priceSnapshot ?? registration.price_snapshot,
    status: registration.status,
    expiresAt: registration.expiresAt || registration.expires_at,
  };
}

function validatePaymentInput({ paymentMethod, paymentReference } = {}) {
  if (!PAYMENT_METHODS.has(paymentMethod)) throw new Error('invalid payment method');
  if (typeof paymentReference !== 'string' || !paymentReference.trim()) {
    throw new Error('payment reference is required');
  }
  return { paymentMethod, paymentReference: paymentReference.trim() };
}

function getMembershipPeriod(start) {
  const startsAt = asDate(start, 'start');
  const expiresAt = new Date(startsAt.getTime());
  // The end is exclusive: access is valid while now < expiresAt.
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  return { startsAt: startsAt.toISOString(), expiresAt: expiresAt.toISOString() };
}

function validateActivationInput({
  tier,
  amount,
  paymentMethod,
  paymentReference,
  activeMembership = false,
  hasActiveMembership = false,
  isActive = false,
  membershipStatus,
  existingMembershipStatus,
} = {}) {
  const expectedAmount = getTierPrice(tier);
  if (amount !== expectedAmount) throw new Error('amount does not match tier price');
  const payment = validatePaymentInput({ paymentMethod, paymentReference });
  if (
    activeMembership ||
    hasActiveMembership ||
    isActive ||
    membershipStatus === 'ACTIVE' ||
    existingMembershipStatus === 'ACTIVE'
  ) throw new Error('active membership already exists');
  return {
    tier,
    amount: expectedAmount,
    ...payment,
  };
}

module.exports = {
  TIER_PRICES,
  PAYMENT_METHODS,
  MEMBERSHIP_REGISTRATION_RATE_LIMIT,
  getTierPrice,
  normalizePhone,
  createMembershipRegistrationRateLimiters,
  makePendingRegistration,
  toPublicRegistration,
  getMembershipPeriod,
  validatePaymentInput,
  validateActivationInput,
};
