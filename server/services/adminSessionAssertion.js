'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

const ALLOWED_ROLES = new Set(['owner', 'branch_admin']);
const ALLOWED_BRANCHES = new Set(['bypass', 'sumber', 'samadikun', 'csb', 'tegal']);

function verifyAdminSessionAssertion(assertion, secret, { now = Date.now(), maxAgeSeconds = 120 } = {}) {
  if (typeof assertion !== 'string' || !assertion || typeof secret !== 'string' || !secret) {
    throw new Error('invalid admin session assertion');
  }

  const parts = assertion.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('invalid admin session assertion');
  const [payload, signature] = parts;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('invalid admin session assertion');
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid admin session assertion');
  }

  const sub = typeof claims?.sub === 'string' ? claims.sub.trim() : '';
  const role = typeof claims?.role === 'string' ? claims.role.trim() : '';
  const branch = typeof claims?.branch === 'string' ? claims.branch.trim().toLowerCase() : null;
  const issuedAt = Number(claims?.iat);
  const nowSeconds = Math.floor(now / 1000);

  if (!sub || !ALLOWED_ROLES.has(role) || !Number.isInteger(issuedAt)) {
    throw new Error('invalid admin session assertion');
  }
  if (issuedAt > nowSeconds + 30 || issuedAt < nowSeconds - maxAgeSeconds) {
    throw new Error('expired admin session assertion');
  }
  if (role === 'branch_admin' && (!branch || !ALLOWED_BRANCHES.has(branch))) {
    throw new Error('invalid admin session assertion');
  }

  return {
    staffId: sub,
    role,
    branch: role === 'branch_admin' ? branch : null,
    sessionVerified: true,
  };
}

module.exports = { verifyAdminSessionAssertion };
