'use strict';

const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const test = require('node:test');
const { verifyAdminSessionAssertion } = require('../services/adminSessionAssertion');

function sign(claims, secret) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

test('admin session assertion preserves verified staff identity and branch scope', () => {
  const now = Date.parse('2026-08-08T10:00:00.000Z');
  const assertion = sign({
    sub: 'session-user-42', role: 'branch_admin', branch: 'csb', iat: Math.floor(now / 1000),
  }, 'server-only-secret');

  assert.deepEqual(verifyAdminSessionAssertion(assertion, 'server-only-secret', { now }), {
    staffId: 'session-user-42', role: 'branch_admin', branch: 'csb', sessionVerified: true,
  });
});

test('admin session assertion rejects tampering, expiry, and invalid branch claims', () => {
  const now = Date.parse('2026-08-08T10:00:00.000Z');
  const issuedAt = Math.floor(now / 1000);
  const valid = sign({ sub: 'owner-1', role: 'owner', branch: null, iat: issuedAt }, 'secret');
  const [payload] = valid.split('.');

  assert.throws(() => verifyAdminSessionAssertion(`${payload}.invalid`, 'secret', { now }), /invalid/i);
  assert.throws(() => verifyAdminSessionAssertion(
    sign({ sub: 'owner-1', role: 'owner', branch: null, iat: issuedAt - 121 }, 'secret'),
    'secret', { now },
  ), /expired/i);
  assert.throws(() => verifyAdminSessionAssertion(
    sign({ sub: 'staff-1', role: 'branch_admin', branch: 'other', iat: issuedAt }, 'secret'),
    'secret', { now },
  ), /invalid/i);
});
