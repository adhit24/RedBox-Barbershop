'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { calculateMembershipExpiry, isActiveMembership } = require('../membership-policy');
const { calculateMembershipExpiry: clientCalculateExpiry } = require('../../public/js/membership-access');

test('shared calculateMembershipExpiry is identical across backend and frontend modules', () => {
  assert.equal(typeof calculateMembershipExpiry, 'function');
  assert.equal(typeof clientCalculateExpiry, 'function');
  const input = '2026-09-17T12:00:00.000Z';
  assert.equal(calculateMembershipExpiry(input), clientCalculateExpiry(input));
});

test('calculateMembershipExpiry: normal date advances exactly 1 calendar year', () => {
  const result = calculateMembershipExpiry('2026-09-17T10:30:00.000Z');
  assert.equal(result, '2027-09-17T10:30:00.000Z');
});

test('calculateMembershipExpiry: month boundary advances exactly 1 calendar year', () => {
  const result = calculateMembershipExpiry('2026-12-31T23:59:59.000Z');
  assert.equal(result, '2027-12-31T23:59:59.000Z');
});

test('calculateMembershipExpiry: leap-day 29 Feb clamps to 28 Feb matching PostgreSQL INTERVAL 1 year', () => {
  // PostgreSQL: '2024-02-29' + interval '1 year' = '2025-02-28'
  const result = calculateMembershipExpiry('2024-02-29T15:45:00.000Z');
  assert.equal(result, '2025-02-28T15:45:00.000Z');

  const leap2020 = calculateMembershipExpiry('2020-02-29T00:00:00.000Z');
  assert.equal(leap2020, '2021-02-28T00:00:00.000Z');
});

test('calculateMembershipExpiry: 28 Feb in non-leap year advances to 28 Feb in leap year', () => {
  const result = calculateMembershipExpiry('2023-02-28T08:00:00.000Z');
  assert.equal(result, '2024-02-28T08:00:00.000Z');
});

test('calculateMembershipExpiry: invalid or empty date inputs return null', () => {
  assert.equal(calculateMembershipExpiry(null), null);
  assert.equal(calculateMembershipExpiry(undefined), null);
  assert.equal(calculateMembershipExpiry(''), null);
  assert.equal(calculateMembershipExpiry('   '), null);
  assert.equal(calculateMembershipExpiry('not-a-valid-date'), null);
});

test('source inspection: /api/auth/me computes membership_expires_at via calculateMembershipExpiry', () => {
  const indexPath = path.join(__dirname, '..', 'index.js');
  const indexSrc = fs.readFileSync(indexPath, 'utf8');

  // Verify import
  assert.match(
    indexSrc,
    /const\s*\{[^}]*calculateMembershipExpiry[^}]*\}\s*=\s*require\(['"]\.\/membership-policy['"]\)/
  );

  // Locate GET /api/auth/me
  const routeStart = indexSrc.indexOf("app.get('/api/auth/me'");
  assert.ok(routeStart > 0, "GET '/api/auth/me' handler must be found");
  const routeEnd = indexSrc.indexOf("app.get('/api/member/history'", routeStart);
  assert.ok(routeEnd > routeStart, "GET '/api/member/history' boundary must follow");
  const routeSrc = indexSrc.slice(routeStart, routeEnd);

  // Verify canonical resolution logic
  assert.match(routeSrc, /customer\.membership_status === 'ACTIVE'/);
  assert.match(routeSrc, /calculateMembershipExpiry/);
  // Verify non-active safeguard: non-active member must never leak active expiry
  assert.match(routeSrc, /customer\.membership_expires_at = null/);
});

test('frontend dashboard computeMembershipLifecycle uses canonical shared helper as defensive fallback', () => {
  const dashJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'dashboard.js'), 'utf8');
  assert.match(dashJs, /window\.RedboxMembership\?\.calculateMembershipExpiry/);
});
