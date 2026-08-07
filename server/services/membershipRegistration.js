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

function makePendingRegistration({ now = new Date(), ...customer } = {}) {
  const createdAt = asDate(now, 'now');
  const expiresAt = new Date(createdAt.getTime());
  expiresAt.setUTCDate(expiresAt.getUTCDate() + PENDING_REGISTRATION_DAYS);
  const priceSnapshot = getTierPrice(customer.tier);

  return {
    ...customer,
    priceSnapshot,
    status: 'PENDING',
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
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
  if (!PAYMENT_METHODS.has(paymentMethod)) throw new Error('invalid payment method');
  if (typeof paymentReference !== 'string' || !paymentReference.trim()) {
    throw new Error('payment reference is required');
  }
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
    paymentMethod,
    paymentReference: paymentReference.trim(),
  };
}

module.exports = {
  TIER_PRICES,
  getTierPrice,
  makePendingRegistration,
  getMembershipPeriod,
  validateActivationInput,
};
