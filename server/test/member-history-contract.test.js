'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('authenticated member history endpoint reads bookings and point transactions', () => {
  const server = read('server/index.js');
  assert.match(server, /app\.get\('\/api\/member\/history'/);
  assert.match(server, /from\('bookings'\)/);
  assert.match(server, /from\('member_point_transactions'\)/);
  assert.match(server, /getMemberPhoneVariants\(session\.customer_wa\)/);
  assert.match(server, /Legacy Moka visits are stored as aggregates/);
  assert.match(server, /Saldo poin tersinkronisasi/);
});

test('dashboard renders server-provided visit history and loads it for OTP members', () => {
  const dashboard = read('js/dashboard.js');
  assert.match(dashboard, /function renderBookingsHistory\(bookings = \[\], summary = \{\}\)/);
  assert.match(dashboard, /fetch\('\/api\/member\/history'/);
  assert.match(dashboard, /await loadMemberHistory\(tok\)/);
  assert.match(dashboard, /bookingsList/);
  assert.match(dashboard, /historyVisitCount/);
  assert.match(dashboard, /booking-history-icon/);
  assert.match(dashboard, /esc\(e\.activity\)/);
  assert.match(dashboard, /renderAggregateFallback/);
  assert.match(dashboard, /visit_count/);
});

test('dashboard does not expose a fake password-change control for OTP accounts', () => {
  const html = read('member-dashboard.html');
  assert.match(html, /Akun member menggunakan OTP WhatsApp dan tidak memakai password/);
  assert.doesNotMatch(html, /id="changePasswordBtn"/);
});
