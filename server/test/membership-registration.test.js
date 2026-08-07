'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TIER_PRICES,
  getTierPrice,
  normalizePhone,
  makePendingRegistration,
  getMembershipPeriod,
  validateActivationInput,
} = require('../services/membershipRegistration');

test('tier catalog returns the fixed price for each paid tier', () => {
  assert.deepEqual(TIER_PRICES, { silver: 100000, gold: 250000, platinum: 1500000 });
  assert.equal(getTierPrice('silver'), 100000);
  assert.equal(getTierPrice('gold'), 250000);
  assert.equal(getTierPrice('platinum'), 1500000);
});

test('registration defaults to PENDING and expires seven days later', () => {
  const registration = makePendingRegistration({
    registrationCode: 'RB-TEST01',
    userKey: 'user-1',
    fullName: 'Test Customer',
    phone: '+628123456789',
    tier: 'gold',
    now: '2026-08-08T10:00:00.000Z',
  });

  assert.equal(registration.status, 'PENDING');
  assert.equal(registration.priceSnapshot, 250000);
  assert.equal(registration.createdAt, '2026-08-08T10:00:00.000Z');
  assert.equal(registration.expiresAt, '2026-08-15T10:00:00.000Z');
  assert.equal(registration.phone, '+628123456789');
});

test('phone format variants normalize to one canonical membership identity', () => {
  assert.equal(normalizePhone('0812-3456-789'), '+628123456789');
  assert.equal(normalizePhone('+62 812 3456 789'), '+628123456789');
  assert.equal(normalizePhone('628123456789'), '+628123456789');
});

test('activation period ends one year after its start date', () => {
  assert.deepEqual(
    getMembershipPeriod('2026-08-08T10:00:00.000Z'),
    {
      startsAt: '2026-08-08T10:00:00.000Z',
      expiresAt: '2027-08-08T10:00:00.000Z',
    }
  );
});

test('invalid tier and invalid payment method are rejected', () => {
  assert.throws(() => getTierPrice('diamond'), /invalid tier/i);
  assert.throws(
    () => validateActivationInput({ tier: 'gold', amount: 250000, paymentMethod: 'card', paymentReference: 'CARD-1' }),
    /invalid payment method/i
  );
});

test('blank payment reference is rejected for cashier activation', () => {
  assert.throws(
    () => validateActivationInput({ tier: 'gold', amount: 250000, paymentMethod: 'cash', paymentReference: '  ' }),
    /payment reference/i
  );
});

test('active duplicate membership is rejected', () => {
  assert.throws(
    () => validateActivationInput({
      tier: 'gold',
      amount: 250000,
      paymentMethod: 'cash',
      paymentReference: 'CASH-1',
      activeMembership: true,
    }),
    /active membership/i
  );
});
