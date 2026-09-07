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
    'booking_insert_failed',
    'booking_created',
    'booking_customer_link_failed',
  ];
  for (const name of requiredOnce) {
    const occurrences = routeBody.split(`eventName: '${name}'`).length - 1;
    assert.equal(occurrences, 1, `expected eventName: '${name}' exactly once, found ${occurrences}`);
  }
  // These two appear twice: once on the confirmed-with-schedule path, once
  // on the moka-bridge-failed / no-schedule path (see Step 10).
  for (const name of ['schedule_create_failed', 'schedule_created', 'booking_confirmed_to_client']) {
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

test('booking_insert_failed and booking_created both carry the bookingId', () => {
  const routeBody = bookingRouteMatch[0];
  const insertFailedBlock = routeBody.match(/if \(error\) \{[\s\S]*?eventName: 'booking_insert_failed'[\s\S]*?\}\);/);
  const createdBlock = routeBody.match(/eventName: 'booking_created'[\s\S]{0,200}/);
  assert.ok(insertFailedBlock, 'expected a booking_insert_failed block inside the insert-error branch');
  assert.match(insertFailedBlock[0], /bookingId/);
  assert.ok(createdBlock, 'expected a booking_created log call');
  assert.match(createdBlock[0], /bookingId: data\.id/);
});
