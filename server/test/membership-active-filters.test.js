'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('active-member benefit and sync filters require an unexpired membership period', () => {
  const reengagement = source(path.join('services', 'reengagement.js'));
  const mokaRoutes = source(path.join('moka', 'routes.js'));
  assert.match(reengagement, /eq\('membership_status', 'ACTIVE'\)[\s\S]{0,160}\.gt\('membership_expires_at', new Date\(\)\.toISOString\(\)\)/);
  assert.match(mokaRoutes, /eq\('membership_status', 'ACTIVE'\)[\s\S]{0,160}\.gt\('membership_expires_at', new Date\(\)\.toISOString\(\)\)/);
});
