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
  const dashboard = read('public/js/dashboard.js');
  assert.match(dashboard, /function renderBookingsHistory\(bookings = \[\], summary = \{\}\)/);
  assert.match(dashboard, /fetch\('\/api\/member\/history'/);
  assert.match(dashboard, /await loadMemberHistory\(tok\)/);
  assert.match(dashboard, /bookingsList/);
  assert.match(dashboard, /if \(!rbToken\)/);
  assert.match(dashboard, /historyVisitCount/);
  assert.match(dashboard, /booking-history-icon/);
  assert.match(dashboard, /esc\(e\.activity\)/);
  assert.match(dashboard, /function renderMemberHistoryFallback\(/);
  assert.match(dashboard, /visit_count/);
});

test('Google/email members also get the aggregate history fallback, not just OTP members', () => {
  const dashboard = read('public/js/dashboard.js');
  // The shared fallback function must be defined once and reused by both
  // sync paths, not duplicated — regression guard for the bug where
  // Google/email-login members saw permanently empty Riwayat
  // Kunjungan/Riwayat Poin tabs because only the OTP path ever called it.
  const fallbackDefs = dashboard.match(/function renderMemberHistoryFallback\(/g) || [];
  assert.equal(fallbackDefs.length, 1, 'renderMemberHistoryFallback must be defined exactly once (shared, not duplicated)');

  const fallbackCalls = dashboard.match(/renderMemberHistoryFallback\(/g) || [];
  // 1 definition + at least 1 call from loadMemberHistory (OTP) + at least 1 call from the Google/email sync block.
  assert.ok(fallbackCalls.length >= 3, `expected at least 3 occurrences (1 def + 2 call sites), found ${fallbackCalls.length}`);

  // The Google/email block ends with the IIFE closing `})();` — the fallback
  // call must appear before that closing, inside the same async block that
  // does the `member_point_transactions` Supabase fetch.
  const emailBlockMatch = dashboard.match(/Google\/email members: Supabase direct sync[\s\S]*?\}\)\(\);/);
  assert.ok(emailBlockMatch, 'expected to find the Google/email sync IIFE block');
  assert.match(emailBlockMatch[0], /renderMemberHistoryFallback\(\);/);
});

test('dashboard does not expose a fake password-change control for OTP accounts', () => {
  const html = read('public/member-dashboard.html');
  assert.match(html, /Akun member menggunakan OTP WhatsApp dan tidak memakai password/);
  assert.doesNotMatch(html, /id="changePasswordBtn"/);
});
