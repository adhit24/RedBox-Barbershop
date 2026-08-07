'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '2026-08-08-paid-membership-registration.sql'),
  'utf8'
);

function position(fragment) {
  const value = migration.indexOf(fragment);
  assert.notEqual(value, -1, `missing migration fragment: ${fragment}`);
  return value;
}

test('atomic activation rejects expired pending registrations before it writes an activation', () => {
  assert.ok(position("IF r.expires_at <= v_now THEN") < position('INSERT INTO member_activations'));
  assert.match(migration, /RAISE EXCEPTION 'membership registration has expired'/);
});

test('atomic activation verifies both targets before activating the registration', () => {
  const activationInsert = position('INSERT INTO member_activations');
  assert.ok(position("RAISE EXCEPTION 'member profile target is missing'") < activationInsert);
  assert.ok(position("RAISE EXCEPTION 'customer target is missing'") < activationInsert);
  const finalRegistrationUpdate = migration.lastIndexOf('UPDATE membership_registrations');
  assert.ok(position("RAISE EXCEPTION 'member profile target was not updated'") < finalRegistrationUpdate);
  assert.ok(position("RAISE EXCEPTION 'customer target was not updated'") < finalRegistrationUpdate);
});

test('database contract constrains payment methods and canonical phone uniqueness', () => {
  assert.match(migration, /CHECK \(payment_method IS NOT NULL AND payment_method IN \('cash', 'qris', 'transfer'\)\) NOT VALID/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION normalize_membership_phone/);
  assert.match(migration, /phone_normalized\s+TEXT NOT NULL/);
  assert.match(migration, /ON membership_registrations \(phone_normalized\)/);
  assert.match(migration, /ON member_profiles \(normalize_membership_phone\(phone\)\)/);
});

test('atomic duplicate protection recognizes both paid periods and grandfathered legacy members', () => {
  assert.match(
    migration,
    /membership_status = 'ACTIVE'[\s\S]{0,180}membership_expires_at > v_now[\s\S]{0,180}membership_started_at IS NULL[\s\S]{0,100}membership_expires_at IS NULL/
  );
});
