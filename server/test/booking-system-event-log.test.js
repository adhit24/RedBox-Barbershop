// server/test/booking-system-event-log.test.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const bookingRouteMatch = server.match(/app\.post\('\/api\/bookings'[\s\S]*?\n\}\);/);

test('the POST /api/bookings route exists and was located for the other assertions', () => {
  assert.ok(bookingRouteMatch, "expected to find the POST '/api/bookings' route handler");
});

test('server/index.js imports logSystemEvent from the system event log service', () => {
  assert.match(server, /const \{ logSystemEvent \} = require\('\.\/services\/systemEventLog'\);/);
});

test('a correlationId is generated once at the start of the route, before body destructuring', () => {
  const routeBody = bookingRouteMatch[0];
  const correlationIdx = routeBody.indexOf('const correlationId = randomUUID();');
  const destructureIdx = routeBody.indexOf('const { name, wa, service_id');
  assert.ok(correlationIdx >= 0, 'expected `const correlationId = randomUUID();`');
  assert.ok(destructureIdx >= 0, 'expected the existing body destructure line to still be present');
  assert.ok(correlationIdx < destructureIdx, 'correlationId must be generated before the body is destructured');
});

test('booking_submit_started is logged with status started', () => {
  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /eventName: 'booking_submit_started'[\s\S]{0,200}status: 'started'|status: 'started'[\s\S]{0,200}eventName: 'booking_submit_started'/);
});

test('every logSystemEvent call site is defended with .catch(() => {}) so a logging failure cannot propagate', () => {
  const routeBody = bookingRouteMatch[0];
  const callSites = routeBody.match(/logSystemEvent\(\{[\s\S]*?\}, \{ supabase \}\)(\.catch\(\(\) => \{\}\))?;/g) || [];
  assert.ok(callSites.length >= 8, `expected at least 8 logSystemEvent call sites in the booking route, found ${callSites.length}`);
  for (const call of callSites) {
    assert.match(call, /\.catch\(\(\) => \{\}\);$/, `logSystemEvent call site is missing .catch(() => {}): ${call}`);
  }
});

test('every required Phase 1 booking event name appears exactly once in the route body', () => {
  const routeBody = bookingRouteMatch[0];
  const requiredOnce = [
    'booking_submit_started',
    'booking_availability_failed',
    'booking_created',
  ];
  for (const name of requiredOnce) {
    const occurrences = routeBody.split(`eventName: '${name}'`).length - 1;
    assert.equal(occurrences, 1, `expected eventName: '${name}' exactly once, found ${occurrences}`);
  }
  // These appear more than once by design:
  //  - schedule_create_failed / schedule_created / booking_confirmed_to_client:
  //    once on the confirmed-with-schedule path, once on the
  //    moka-bridge-failed / no-schedule path (see Step 10).
  //  - booking_insert_failed: once in the insert-error branch, once more in
  //    the route's outer catch (final-review Finding 2 — instrumenting the
  //    previously-uninstrumented terminal 500 path).
  //  - booking_customer_link_failed: once for the "not attempted" (healthy,
  //    common) case logged as INFO/skipped, once for an actual write
  //    failure logged as WARNING/failed (final-review Finding 1) — the
  //    event NAME is reused per the plan's fixed event-name contract, only
  //    severity/status differ.
  for (const name of ['schedule_create_failed', 'schedule_created', 'booking_confirmed_to_client', 'booking_insert_failed', 'booking_customer_link_failed']) {
    const occurrences = routeBody.split(`eventName: '${name}'`).length - 1;
    assert.ok(occurrences >= 1, `expected at least one eventName: '${name}', found ${occurrences}`);
  }
  assert.ok(routeBody.split("eventName: 'booking_validation_failed'").length - 1 >= 1, 'expected at least one booking_validation_failed');
  assert.ok(routeBody.split("eventName: 'booking_notification_failed'").length - 1 >= 1, 'expected at least one booking_notification_failed');
});

test('booking_confirmed_to_client is never logged before the bookings insert result (data.id) exists', () => {
  const routeBody = bookingRouteMatch[0];
  const insertIdx = routeBody.indexOf("supabase.from('bookings').insert([{");
  const firstConfirmedIdx = routeBody.indexOf("eventName: 'booking_confirmed_to_client'");
  assert.ok(insertIdx >= 0, 'expected the bookings insert call');
  assert.ok(firstConfirmedIdx >= 0, 'expected at least one booking_confirmed_to_client log call');
  assert.ok(insertIdx < firstConfirmedIdx, 'booking_confirmed_to_client must be logged after the insert, never before');
});

test('booking_customer_link_failed is only logged when linkage was not persisted', () => {
  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /if \(linkageResult\.persistence_status !== 'persisted'\)/);
});

test('booking_customer_link_failed logs INFO/skipped for the not_attempted (healthy) case and WARNING/failed for actual write problems', () => {
  const routeBody = bookingRouteMatch[0];
  const notAttemptedBlock = routeBody.match(/if \(linkageResult\.persistence_status === 'not_attempted'\) \{[\s\S]*?\}, \{ supabase \}\)\.catch\(\(\) => \{\}\);/);
  assert.ok(notAttemptedBlock, 'expected a not_attempted branch logging booking_customer_link_failed');
  assert.match(notAttemptedBlock[0], /severity: 'INFO', status: 'skipped'/);

  const writeFailedBlock = routeBody.match(/\} else if \(linkageResult\.persistence_status !== 'persisted'\) \{[\s\S]*?\}, \{ supabase \}\)\.catch\(\(\) => \{\}\);/);
  assert.ok(writeFailedBlock, 'expected a write-failed branch logging booking_customer_link_failed');
  assert.match(writeFailedBlock[0], /severity: 'WARNING', status: 'failed'/);
});

test('the route outer catch (unexpected exception) logs booking_insert_failed before returning 500', () => {
  const routeBody = bookingRouteMatch[0];
  const catchBlock = routeBody.match(/console\.error\('Supabase POST Error:', err\);[\s\S]*?return res\.status\(500\)\.json\(\{ error: err\.message \}\);/);
  assert.ok(catchBlock, 'expected the outer Supabase-branch catch block');
  assert.match(catchBlock[0], /eventName: 'booking_insert_failed'/);
  assert.match(catchBlock[0], /severity: 'ERROR', status: 'failed'/);
  assert.match(catchBlock[0], /\.catch\(\(\) => \{\}\);/);
});

test('membership abuse-gate rejections (MEMBER_LOGIN_REQUIRED, MEMBER_IDENTITY_MISMATCH) are logged before their return', () => {
  const routeBody = bookingRouteMatch[0];
  const loginRequiredBlock = routeBody.match(/if \(!sessionMatchesPhone\) \{[\s\S]*?\}\);\s*\}/);
  assert.ok(loginRequiredBlock, 'expected the sessionMatchesPhone guard block');
  assert.match(loginRequiredBlock[0], /eventName: 'booking_validation_failed'/);
  assert.match(loginRequiredBlock[0], /errorCode: 'MEMBER_LOGIN_REQUIRED'/);
  assert.match(loginRequiredBlock[0], /httpStatus: 401/);

  const identityMismatchBlock = routeBody.match(/if \(!sameIdentityName\(name, memberProfile\?\.full_name\)\) \{[\s\S]*?\}\);\s*\}/);
  assert.ok(identityMismatchBlock, 'expected the sameIdentityName guard block');
  assert.match(identityMismatchBlock[0], /eventName: 'booking_validation_failed'/);
  assert.match(identityMismatchBlock[0], /errorCode: 'MEMBER_IDENTITY_MISMATCH'/);
  assert.match(identityMismatchBlock[0], /httpStatus: 403/);
});

test('booking_insert_failed and booking_created both carry the bookingId', () => {
  const routeBody = bookingRouteMatch[0];
  const insertFailedBlock = routeBody.match(/if \(error\) \{[\s\S]*?eventName: 'booking_insert_failed'[\s\S]*?\}\);/);
  const createdBlock = routeBody.match(/eventName: 'booking_created'[\s\S]{0,200}/);
  assert.ok(insertFailedBlock, 'expected a booking_insert_failed block inside the insert-error branch');
  assert.match(insertFailedBlock[0], /bookingId/);
  assert.ok(createdBlock, 'expected a booking_created log call');
  assert.match(createdBlock[0], /bookingId: data\.id/);
});
