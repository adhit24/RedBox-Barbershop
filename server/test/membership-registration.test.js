'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TIER_PRICES,
  getTierPrice,
  isTierUpgrade,
  normalizePhone,
  makePendingRegistration,
  expirePendingMembershipRegistrations,
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
  assert.equal(normalizePhone('(0812) 3456-789'), '+628123456789');
  assert.equal(normalizePhone('8123456789'), '+628123456789');
});

test('short, non-mobile, foreign, malformed, and overlong phones are rejected', () => {
  for (const phone of [
    '08123',
    '021-555-1234',
    '+1 202 555 0100',
    '0812abc3456789',
    '0812345678901234',
    '0062 812 3456 789',
  ]) {
    assert.throws(() => normalizePhone(phone), /invalid Indonesian mobile phone/i, phone);
  }
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

test('pending expiry is idempotent and only marks stale PENDING registrations', async () => {
  const registrations = [
    { id: 'stale', status: 'PENDING', expires_at: '2026-08-08T09:59:59.999Z' },
    { id: 'live', status: 'PENDING', expires_at: '2026-08-08T10:00:00.001Z' },
    { id: 'activated', status: 'ACTIVATED', expires_at: '2025-01-01T00:00:00.000Z' },
    { id: 'history', status: 'EXPIRED', expires_at: '2024-01-01T00:00:00.000Z' },
  ];
  const activationHistory = [{ id: 'activation-1', registration_id: 'activated', amount: 250000 }];
  const supabase = {
    from(table) {
      assert.equal(table, 'membership_registrations');
      const filters = [];
      let patch;
      return {
        update(value) { patch = value; return this; },
        eq(column, value) { filters.push((row) => row[column] === value); return this; },
        lte(column, value) { filters.push((row) => row[column] <= value); return this; },
        async select() {
          const matched = registrations.filter((row) => filters.every((filter) => filter(row)));
          for (const row of matched) Object.assign(row, patch);
          return { data: matched.map(({ id }) => ({ id })), error: null };
        },
      };
    },
  };

  const first = await expirePendingMembershipRegistrations(supabase, '2026-08-08T10:00:00.000Z');
  const second = await expirePendingMembershipRegistrations(supabase, '2026-08-08T10:00:00.000Z');

  assert.equal(first.expiredCount, 1);
  assert.equal(second.expiredCount, 0);
  assert.deepEqual(registrations.map(({ id, status }) => ({ id, status })), [
    { id: 'stale', status: 'EXPIRED' },
    { id: 'live', status: 'PENDING' },
    { id: 'activated', status: 'ACTIVATED' },
    { id: 'history', status: 'EXPIRED' },
  ]);
  assert.deepEqual(activationHistory, [{ id: 'activation-1', registration_id: 'activated', amount: 250000 }]);
});

test('upgrade accepts only a higher destination tier and always uses its catalog price', () => {
  assert.equal(isTierUpgrade('silver', 'gold'), true);
  assert.equal(isTierUpgrade('silver', 'platinum'), true);
  assert.equal(isTierUpgrade('gold', 'platinum'), true);
  assert.equal(isTierUpgrade('gold', 'silver'), false);
  assert.equal(isTierUpgrade('platinum', 'platinum'), false);
  assert.equal(getTierPrice('platinum'), 1500000);
});
