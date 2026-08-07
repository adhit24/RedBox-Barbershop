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

test('registration RPC serializes canonical identities and uniquely guards pending operation identity', () => {
  const registrationRpc = position('CREATE OR REPLACE FUNCTION create_membership_registration');
  const advisoryLock = position("pg_advisory_xact_lock(hashtextextended('membership-registration:' || v_phone, 0))");
  const pendingLookup = position('SELECT mr.* INTO v_registration');
  assert.ok(registrationRpc < advisoryLock);
  assert.ok(advisoryLock < pendingLookup);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_registrations_pending_operation[\s\S]+phone_normalized,[\s\S]+tier,[\s\S]+registration_type,[\s\S]+COALESCE\(source_registration_id[\s\S]+WHERE status = 'PENDING'/
  );
});

test('registration RPC owns all identity and registration writes in one database transaction', () => {
  const start = position('CREATE OR REPLACE FUNCTION create_membership_registration');
  const end = position('CREATE OR REPLACE FUNCTION activate_membership_registration');
  const registrationRpc = migration.slice(start, end);
  assert.match(registrationRpc, /INSERT INTO member_profiles/);
  assert.match(registrationRpc, /INSERT INTO customers/);
  assert.match(registrationRpc, /INSERT INTO membership_registrations/);
  assert.match(registrationRpc, /normalize_membership_phone\(mp\.phone\) = v_phone/);
});

test('customer matching checks both canonical phone fields across registration and activation', () => {
  const registrationStart = position('CREATE OR REPLACE FUNCTION create_membership_registration');
  const activationStart = position('CREATE OR REPLACE FUNCTION activate_membership_registration');
  const registrationRpc = migration.slice(registrationStart, activationStart);
  const activationRpc = migration.slice(activationStart);
  const registrationMatches = registrationRpc.match(
    /\(\s*normalize_membership_phone\(c\.phone_e164\) = v_phone\s+OR\s+normalize_membership_phone\(c\.wa\) = v_phone\s*\)/g
  ) || [];
  const activationMatches = activationRpc.match(
    /\(\s*normalize_membership_phone\(phone_e164\) = r\.phone_normalized\s+OR\s+normalize_membership_phone\(wa\) = r\.phone_normalized\s*\)/g
  ) || [];

  assert.equal(registrationMatches.length, 2, 'active conflict and identity lookup must both use OR matching');
  assert.equal(activationMatches.length, 2, 'activation target lock and update must both use OR matching');
  assert.doesNotMatch(registrationRpc, /COALESCE\(\s*normalize_membership_phone\(c\.phone_e164\)/);
  assert.doesNotMatch(activationRpc, /COALESCE\(\s*normalize_membership_phone\(phone_e164\)/);
});

test('database phone normalization rejects invalid Indonesian mobile lengths', () => {
  assert.match(migration, /value ~ '\^\[\+\]628\[1-9\]\[0-9\]\{7,10\}\$'/);
});

test('atomic duplicate protection recognizes both paid periods and grandfathered legacy members', () => {
  assert.match(
    migration,
    /membership_status = 'ACTIVE'[\s\S]{0,180}membership_expires_at > v_now[\s\S]{0,180}membership_started_at IS NULL[\s\S]{0,100}membership_expires_at IS NULL/
  );
});
