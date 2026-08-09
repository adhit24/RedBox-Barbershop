'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..', 'public');

function source(relativePath) {
  return fs.readFileSync(path.join(workspace, relativePath), 'utf8');
}

test('paid membership access requires an expiry later than now', () => {
  const { isActiveMembership } = require('../../public/js/membership-access');
  const now = '2026-08-08T10:00:00.000Z';

  assert.equal(isActiveMembership({
    membership_status: 'ACTIVE',
    membership_started_at: '2026-01-01T00:00:00.000Z',
    membership_expires_at: '2027-01-01T00:00:00.000Z',
  }, now), true);
  assert.equal(isActiveMembership({
    membership_status: 'ACTIVE',
    membership_started_at: '2025-08-08T10:00:00.000Z',
    membership_expires_at: '2026-08-08T10:00:00.000Z',
  }, now), false);
  assert.equal(isActiveMembership({
    membership_status: 'ACTIVE',
    membership_started_at: '2026-08-08T10:00:00.000Z',
    membership_expires_at: null,
  }, now), false);
});

test('grandfathered active legacy members remain compatible without paid period fields', () => {
  const { isActiveMembership } = require('../../public/js/membership-access');

  assert.equal(isActiveMembership({ membership_status: 'ACTIVE' }, '2026-08-08T10:00:00.000Z'), true);
  assert.equal(isActiveMembership({ membership_status: 'INACTIVE' }, '2026-08-08T10:00:00.000Z'), false);
});

test('dashboard and AI gates load and use the shared membership access policy', () => {
  const dashboard = source(path.join('js', 'dashboard.js'));
  const aiGrooming = source(path.join('js', 'ai-grooming.js'));
  const dashboardHtml = source('member-dashboard.html');
  const homeHtml = source('index.html');

  assert.match(dashboard, /RedboxMembership\.isActiveMembership/);
  assert.match(aiGrooming, /RedboxMembership\.isActiveMembership/);
  assert.ok(dashboardHtml.indexOf('js/membership-access.js') < dashboardHtml.indexOf('js/dashboard.js'));
  assert.ok(homeHtml.indexOf('js/membership-access.js') < homeHtml.indexOf('js/ai-grooming.js'));
  assert.match(dashboard, /membership_started_at/);
  assert.match(dashboard, /membership_expires_at/);
});
