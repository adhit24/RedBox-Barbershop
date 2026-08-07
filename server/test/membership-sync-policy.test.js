'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { isActiveMembership, membershipStateForSync } = require('../membership-policy');

test('sync keeps an existing inactive membership inactive', () => {
  assert.deepEqual(
    membershipStateForSync({ existingStatus: 'INACTIVE' }),
    { membership_status: 'INACTIVE', membership_activated_at: null, membership_expires_at: null }
  );
});

test('sync keeps an unexpired existing membership active', () => {
  assert.deepEqual(
    membershipStateForSync({
      existingStatus: 'ACTIVE',
      existingActivatedAt: '2026-08-01T10:00:00.000Z',
      existingExpiresAt: '2027-08-01T10:00:00.000Z',
      now: '2026-08-08T10:00:00.000Z',
    }),
    {
      membership_status: 'ACTIVE',
      membership_activated_at: '2026-08-01T10:00:00.000Z',
      membership_expires_at: '2027-08-01T10:00:00.000Z',
    }
  );
});

test('sync may preserve active state from a previously activated customer record', () => {
  assert.deepEqual(
    membershipStateForSync({
      existingStatus: null,
      customerStatus: 'ACTIVE',
      customerActivatedAt: '2026-08-02T10:00:00.000Z',
      customerExpiresAt: '2027-08-02T10:00:00.000Z',
      now: '2026-08-08T10:00:00.000Z',
    }),
    {
      membership_status: 'ACTIVE',
      membership_activated_at: '2026-08-02T10:00:00.000Z',
      membership_expires_at: '2027-08-02T10:00:00.000Z',
    }
  );
});

test('sync creates a new profile as inactive by default', () => {
  assert.deepEqual(
    membershipStateForSync({ existingStatus: null }),
    {
      membership_status: 'INACTIVE',
      membership_activated_at: null,
      membership_expires_at: null,
    }
  );
});

test('expired or incomplete paid ACTIVE status cannot survive sync or benefit checks', () => {
  assert.equal(isActiveMembership({
    status: 'ACTIVE', startsAt: '2025-08-08T10:00:00.000Z',
    expiresAt: '2026-08-08T09:59:59.999Z', now: '2026-08-08T10:00:00.000Z',
  }), false);
  assert.equal(isActiveMembership({
    status: 'ACTIVE', startsAt: '2026-08-08T10:00:00.000Z',
    expiresAt: null, now: '2026-08-08T10:00:00.000Z',
  }), false);
  assert.deepEqual(
    membershipStateForSync({
      existingStatus: 'ACTIVE',
      existingActivatedAt: '2025-08-08T10:00:00.000Z',
      existingStartedAt: '2025-08-08T10:00:00.000Z',
      existingExpiresAt: '2026-08-08T10:00:00.000Z',
      now: '2026-08-08T10:00:00.000Z',
    }),
    {
      membership_status: 'INACTIVE',
      membership_activated_at: null,
      membership_expires_at: '2026-08-08T10:00:00.000Z',
    }
  );
});

test('undated ACTIVE legacy membership remains grandfathered', () => {
  assert.equal(isActiveMembership({
    status: 'ACTIVE', startsAt: null, expiresAt: null, now: '2026-08-08T10:00:00.000Z',
  }), true);
  assert.deepEqual(
    membershipStateForSync({
      existingStatus: 'ACTIVE',
      existingActivatedAt: '2025-01-01T00:00:00.000Z',
      now: '2026-08-08T10:00:00.000Z',
    }),
    {
      membership_status: 'ACTIVE',
      membership_activated_at: '2025-01-01T00:00:00.000Z',
      membership_expires_at: null,
    }
  );
});
