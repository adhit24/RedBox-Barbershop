'use strict';

const TIER_PRICES = Object.freeze({
  silver: 100000,
  gold: 250000,
  platinum: 1500000,
});

const PAYMENT_METHODS = new Set(['cash', 'qris', 'transfer']);
const PENDING_REGISTRATION_DAYS = 7;

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
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) throw new Error('phone is required');
  if (digits.startsWith('62')) return `+${digits}`;
  if (digits.startsWith('0')) return `+62${digits.slice(1)}`;
  return `+62${digits}`;
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
    registrationId: registration.registrationId || registration.id,
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
  getTierPrice,
  normalizePhone,
  makePendingRegistration,
  toPublicRegistration,
  getMembershipPeriod,
  validatePaymentInput,
  validateActivationInput,
};
