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

test('terminal booking events are awaited before returning HTTP responses (Blocker 1)', () => {
  const routeBody = bookingRouteMatch[0];

  // Terminal validation failure is awaited before returning 400/401/403/409/500
  assert.match(routeBody, /await logSystemEvent\(\{[\s\S]*?eventName: 'booking_validation_failed'[\s\S]*?\}, \{ supabase \}\);[\s\r\n]*return res\.status\(/);

  // Terminal availability failure is awaited before returning 409
  assert.match(routeBody, /await logSystemEvent\(\{[\s\S]*?eventName: 'booking_availability_failed'[\s\S]*?\}, \{ supabase \}\);[\s\r\n]*return res\.status\(409\)/);

  // Terminal booking_insert_failed is awaited before returning 500
  assert.match(routeBody, /await logSystemEvent\(\{[\s\S]*?eventName: 'booking_insert_failed'[\s\S]*?\}, \{ supabase \}\);[\s\r\n]*return res\.status\(500\)/);

  // Terminal success (booking_confirmed_to_client) is awaited before returning 201
  assert.match(routeBody, /await logSystemEvent\(\{[\s\S]*?eventName: 'booking_confirmed_to_client'[\s\S]*?\}, \{ supabase \}\);[\s\r\n]*return res\.status\(201\)/);

  // Outer 500 catch awaits booking_insert_failed
  const outerCatch = routeBody.match(/console\.error\('Supabase POST Error:', err\);[\s\S]*?return res\.status\(500\)\.json\(\{ error: err\.message \}\);/);
  assert.ok(outerCatch, 'expected outer catch block');
  assert.match(outerCatch[0], /await logSystemEvent\(\{[\s\S]*?eventName: 'booking_insert_failed'/);
});

test('non-terminal diagnostic events retain fire-and-forget .catch(() => {})', () => {
  const routeBody = bookingRouteMatch[0];
  const fireAndForgetEvents = ['booking_submit_started', 'booking_created', 'booking_customer_link_failed', 'booking_notification_failed'];
  for (const name of fireAndForgetEvents) {
    const blockRegex = new RegExp(`eventName: '${name}'[\\s\\S]*?\\.catch\\(\\(\\) => \\{\\}\\);`);
    assert.match(routeBody, blockRegex, `expected non-terminal ${name} to use fire-and-forget .catch(() => {})`);
  }
});

test('every required Phase 1 booking event name appears in the route body', () => {
  const routeBody = bookingRouteMatch[0];
  const requiredOnce = [
    'booking_submit_started',
    'booking_created',
  ];
  for (const name of requiredOnce) {
    const occurrences = routeBody.split(`eventName: '${name}'`).length - 1;
    assert.equal(occurrences, 1, `expected eventName: '${name}' exactly once, found ${occurrences}`);
  }
  // These appear more than once by design:
  //  - booking_availability_failed: once for barber holiday, once for slot overlap (Gap 3)
  //  - schedule_create_failed / schedule_created / booking_confirmed_to_client / booking_schedule_incomplete:
  //    schedule success vs schedule missing/error paths (Blocker 2 & Round 2)
  //  - booking_insert_failed: once in insert-error branch, once in route outer catch
  //  - booking_customer_link_failed: once for not_attempted (skipped), once for write failed
  for (const name of ['booking_availability_failed', 'schedule_create_failed', 'schedule_created', 'booking_confirmed_to_client', 'booking_schedule_incomplete', 'booking_insert_failed', 'booking_customer_link_failed']) {
    const occurrences = routeBody.split(`eventName: '${name}'`).length - 1;
    assert.ok(occurrences >= 1, `expected at least one eventName: '${name}', found ${occurrences}`);
  }
  assert.ok(routeBody.split("eventName: 'booking_validation_failed'").length - 1 >= 5, 'expected at least 5 booking_validation_failed call sites');
  assert.ok(routeBody.split("eventName: 'booking_notification_failed'").length - 1 >= 1, 'expected at least one booking_notification_failed');
});

test('all early returns are instrumented with event logs (Gap 3)', () => {
  const routeBody = bookingRouteMatch[0];

  // 1. Branch required ("Cabang wajib dipilih")
  const branchReq = routeBody.match(/if \(!resolvedInputLocation\) \{[\s\S]*?return res\.status\(400\)\.json\(\{ error: 'Cabang wajib dipilih' \}\);/);
  assert.ok(branchReq, 'expected branch required guard');
  assert.match(branchReq[0], /await logSystemEvent\(\{[\s\S]*?eventName: 'booking_validation_failed'[\s\S]*?errorMessage: 'Cabang wajib dipilih'/);

  // 2. Barber required ("Kapster wajib dipilih sebelum booking")
  const barberReq = routeBody.match(/if \(!normalizedBarberId \|\| normalizedBarberId === 'any'\) \{[\s\S]*?return res\.status\(400\)\.json\(\{ error: 'Kapster wajib dipilih sebelum booking' \}\);/);
  assert.ok(barberReq, 'expected barber required guard');
  assert.match(barberReq[0], /await logSystemEvent\(\{[\s\S]*?eventName: 'booking_validation_failed'[\s\S]*?errorMessage: 'Kapster wajib dipilih sebelum booking'/);

  // 3. Barber lookup failure 500 ("Gagal memvalidasi kapster")
  const barberErrBlock = routeBody.match(/if \(barberErr && barberErr\.code !== 'PGRST116'\) \{[\s\S]*?return res\.status\(500\)\.json\(\{ error: 'Gagal memvalidasi kapster' \}\);/);
  assert.ok(barberErrBlock, 'expected barberErr 500 guard');
  assert.match(barberErrBlock[0], /await logSystemEvent\(\{[\s\S]*?severity: 'ERROR'[\s\S]*?httpStatus: 500/);

  // 4. Barber holiday unavailable 409 ("Kapster sedang libur pada tanggal tersebut")
  const barberHolidayBlock = routeBody.match(/if \(!barberAvailability\.isWorking\) \{[\s\S]*?return res\.status\(409\)\.json\(\{ error: 'Kapster sedang libur pada tanggal tersebut' \}\);/);
  assert.ok(barberHolidayBlock, 'expected barber holiday 409 guard');
  assert.match(barberHolidayBlock[0], /await logSystemEvent\(\{[\s\S]*?eventName: 'booking_availability_failed'[\s\S]*?httpStatus: 409/);
});

test('when bridgeBookingToMoka returns scheduleId:null without throwing, schedule_create_failed and booking_schedule_incomplete are logged (Blocker 2 & Round 2)', () => {
  const routeBody = bookingRouteMatch[0];
  const bridgeSuccessAndNullBlock = routeBody.match(/const r = await require\('\.\/moka\/sync'\)\.bridgeBookingToMoka\(supabase[\s\S]*?\} else \{[\s\S]*?return res\.status\(201\)\.json\(\{ data, autoBooked: true, scheduleId: null, mokaSync: r\.mokaSync, homeServiceJobId: null \}\);/);
  assert.ok(bridgeSuccessAndNullBlock, 'expected the if (r.scheduleId) ... else ... block after bridgeBookingToMoka');

  const elseBlock = bridgeSuccessAndNullBlock[0].split('} else {')[1];
  // Must record schedule_create_failed
  assert.match(elseBlock, /eventName: 'schedule_create_failed'/);
  assert.match(elseBlock, /status: 'failed'/);

  // Must NOT record booking_confirmed_to_client in this failure/partial path
  assert.doesNotMatch(elseBlock, /eventName: 'booking_confirmed_to_client'/);

  // Must record booking_schedule_incomplete as WARNING / partial
  assert.match(elseBlock, /eventName: 'booking_schedule_incomplete'[\s\S]*?severity: 'WARNING'[\s\S]*?status: 'partial'/);
});

test('booking_confirmed_to_client is strictly reserved for the true success invariant (Round 2)', () => {
  const routeBody = bookingRouteMatch[0];
  const confirmedOccurrences = routeBody.match(/eventName: 'booking_confirmed_to_client'[\s\S]*?severity: '([^']+)'[\s\S]*?status: '([^']+)'/g) || [];
  assert.ok(confirmedOccurrences.length >= 1, 'expected at least one booking_confirmed_to_client call');

  for (const occurrence of confirmedOccurrences) {
    assert.match(occurrence, /severity: 'INFO'/);
    assert.match(occurrence, /status: 'success'/);
  }
});

test('when bridgeBookingToMoka returns scheduleId present, schedule_created and confirmed_to_client are logged with INFO/success', () => {
  const routeBody = bookingRouteMatch[0];
  const bridgeSuccessAndNullBlock = routeBody.match(/const r = await require\('\.\/moka\/sync'\)\.bridgeBookingToMoka\(supabase[\s\S]*?\} else \{/);
  assert.ok(bridgeSuccessAndNullBlock, 'expected if (r.scheduleId) block');

  const successPath = bridgeSuccessAndNullBlock[0];
  assert.match(successPath, /eventName: 'schedule_created'[\s\S]*?severity: 'INFO'[\s\S]*?status: 'success'/);
  assert.match(successPath, /eventName: 'booking_confirmed_to_client'[\s\S]*?severity: 'INFO'[\s\S]*?status: 'success'/);
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
  assert.match(catchBlock[0], /await logSystemEvent\(/);
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
