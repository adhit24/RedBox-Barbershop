'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('active-member benefit and sync filters allow only unexpired paid or undated legacy memberships', () => {
  const reengagement = source(path.join('services', 'reengagement.js'));
  const mokaRoutes = source(path.join('moka', 'routes.js'));
  const safeFilter = /eq\('membership_status', 'ACTIVE'\)[\s\S]{0,240}\.or\(`membership_expires_at\.gt\.\$\{now\},and\(membership_started_at\.is\.null,membership_expires_at\.is\.null\)`\)/;
  assert.match(reengagement, safeFilter);
  assert.match(mokaRoutes, safeFilter);
});

test('legacy dashboard keeps points visible and permits base reward redemption without paid tier access', () => {
  const dashboard = source(path.join('..', 'public', 'js', 'dashboard.js'));
  assert.match(dashboard, /let point_system = true/);
  assert.match(dashboard, /const unlocked = rTierIdx === 0 \|\| \(ACTIVE && userTierIdx >= rTierIdx\)/);
  assert.match(dashboard, /const history = memberData\.pointsHistory \|\| \[\]/);
});
