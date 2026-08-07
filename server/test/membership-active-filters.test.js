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
