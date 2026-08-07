'use strict';

const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const test = require('node:test');
const {
  requireAdminSessionProxySecret,
  verifyAdminSessionAssertion,
} = require('../services/adminSessionAssertion');
const {
  requireAdminSessionProxySecret: requireNextAdminSessionProxySecret,
} = require('../../frontend/src/app/api/admin/crm/membership/_proxySecret.ts');

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

  assert.deepEqual(verifyAdminSessionAssertion(assertion, {
    adminSessionProxySecret: 'server-only-secret',
    adminPassword: 'legacy-browser-password',
  }, { now }), {
    staffId: 'session-user-42', role: 'branch_admin', branch: 'csb', sessionVerified: true,
  });
});

test('admin session assertion rejects tampering, expiry, and invalid branch claims', () => {
  const now = Date.parse('2026-08-08T10:00:00.000Z');
  const issuedAt = Math.floor(now / 1000);
  const valid = sign({ sub: 'owner-1', role: 'owner', branch: null, iat: issuedAt }, 'secret');
  const [payload] = valid.split('.');

  const credentials = {
    adminSessionProxySecret: 'secret',
    adminPassword: 'legacy-browser-password',
  };

  assert.throws(() => verifyAdminSessionAssertion(`${payload}.invalid`, credentials, { now }), /invalid/i);
  assert.throws(() => verifyAdminSessionAssertion(
    sign({ sub: 'owner-1', role: 'owner', branch: null, iat: issuedAt - 121 }, 'secret'),
    credentials, { now },
  ), /expired/i);
  assert.throws(() => verifyAdminSessionAssertion(
    sign({ sub: 'staff-1', role: 'branch_admin', branch: 'other', iat: issuedAt }, 'secret'),
    credentials, { now },
  ), /invalid/i);
});

test('admin session assertion rejects signatures made with the browser-exposed admin password', () => {
  const now = Date.parse('2026-08-08T10:00:00.000Z');
  const adminPassword = 'legacy-browser-password';
  const assertion = sign({
    sub: 'forged-owner', role: 'owner', branch: null, iat: Math.floor(now / 1000),
  }, adminPassword);

  assert.throws(() => verifyAdminSessionAssertion(assertion, {
    adminSessionProxySecret: 'separate-server-only-secret',
    adminPassword,
  }, { now }), /invalid admin session assertion/i);
});

test('backend verifier fails closed when the proxy secret is missing or equals the admin password', () => {
  assert.throws(() => requireAdminSessionProxySecret({
    adminSessionProxySecret: '',
    adminPassword: 'legacy-browser-password',
  }), /not configured securely/i);
  assert.throws(() => requireAdminSessionProxySecret({
    adminSessionProxySecret: 'same-secret',
    adminPassword: 'same-secret',
  }), /not configured securely/i);
});

test('Next adapter fails closed when the proxy secret is missing or equals the admin password', () => {
  assert.throws(() => requireNextAdminSessionProxySecret({
    ADMIN_SESSION_PROXY_SECRET: '',
    ADMIN_PASSWORD: 'legacy-browser-password',
  }), /not configured securely/i);
  assert.throws(() => requireNextAdminSessionProxySecret({
    ADMIN_SESSION_PROXY_SECRET: 'same-secret',
    ADMIN_PASSWORD: 'same-secret',
  }), /not configured securely/i);
  assert.equal(requireNextAdminSessionProxySecret({
    ADMIN_SESSION_PROXY_SECRET: 'separate-server-only-secret',
    ADMIN_PASSWORD: 'legacy-browser-password',
  }), 'separate-server-only-secret');
});
