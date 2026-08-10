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

test('server/index.js imports computeServiceDiscount from membership-benefits', () => {
  assert.match(server, /const \{ computeServiceDiscount \} = require\('\.\/membership-benefits'\);/);
});

test('the route destructures a group flag from the request body', () => {
  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /const \{ name, wa, service_id, service, price, duration, barber_id, date, time, location, notes, payment, status, type, address, group \} = req\.body;/);
});

test('discount computation is skipped for admin, wedding, home service, and group bookings', () => {
  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /if \(!isAdmin && !isWeddingBooking\(\{ type, service \}\) && bookingType !== 'home_service' && !isGroupBooking\)/);
});

test('isWeddingBooking is a single shared check used by both the price and the discount-eligibility gate', () => {
  // Regression guard: normalizeBookingPrice used to price a booking as a
  // wedding package whenever the service text mentioned "wedding", while
  // the discount gate only checked the `type` field — a mismatched payload
  // (type: 'outlet', service: "Wedding ... Package") could get wedding
  // pricing and still qualify for an automatic tier discount on top of it.
  assert.match(server, /function isWeddingBooking\(\{ type, service \}\)/);
  const helperMatch = server.match(/function isWeddingBooking\(\{ type, service \}\) \{[\s\S]*?\n\}/);
  assert.ok(helperMatch, 'expected to find the isWeddingBooking helper body');
  assert.match(helperMatch[0], /serviceName\.includes\('wedding'\)/);
  assert.match(helperMatch[0], /serviceName\.includes\('weeding'\)/);

  const priceFnMatch = server.match(/function normalizeBookingPrice\([\s\S]*?\n\}/);
  assert.ok(priceFnMatch, 'expected to find normalizeBookingPrice');
  assert.match(priceFnMatch[0], /isWeddingBooking\(\{ type, service \}\)/);

  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /!isWeddingBooking\(\{ type, service \}\)/);
});

test('the group-booking exclusion cross-checks the client group flag against the [GROUP:...] notes marker', () => {
  // Regression guard: a direct API call could submit group: false on a
  // booking whose notes already carry the [GROUP:...] marker booking.js
  // writes for a real group-booking leg, bypassing the group exclusion.
  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /const isGroupBooking = !!group \|\| \/\\\[GROUP:\/\.test\(String\(notes \|\| ''\)\)/);
});

test('discount is computed from a server-side member lookup by phone, never from client input', () => {
  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /const memberProfile = await getMemberProfileByPhone\(wa\);/);
  assert.match(routeBody, /const memberActive = isActiveMembership\(\{/);
  assert.match(routeBody, /computeServiceDiscount\(\{/);
  assert.match(routeBody, /tier: memberProfile\?\.current_tier/);
  assert.match(routeBody, /birthdate: memberProfile\?\.birthdate/);
});

test('the insert writes finalPrice into price and carries original_price/discount_label', () => {
  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /price:\s*finalPrice/);
  assert.match(routeBody, /original_price:\s*originalPrice/);
  assert.match(routeBody, /discount_label:\s*discountLabel/);
});

test('the WA booking-confirmation template includes a discount line when discount_label is present', () => {
  const waNotif = fs.readFileSync(path.join(__dirname, '..', 'services', 'waNotification.js'), 'utf8');
  assert.match(waNotif, /discount_label,\s*original_price/);
  assert.match(waNotif, /const diskon = discount_label/);
  assert.match(waNotif, /\$\{service\}\$\{harga\}\$\{durasi\}\$\{diskon\}/);
});

test('the WA confirmation still shows the price line when price is exactly 0 (fully-discounted booking)', () => {
  // Regression guard: `price ? ... : ''` is a truthy check, so a booking
  // charged exactly Rp0 (reachable via the Platinum free-grooming benefit)
  // silently dropped its price line entirely.
  const waNotif = fs.readFileSync(path.join(__dirname, '..', 'services', 'waNotification.js'), 'utf8');
  assert.match(waNotif, /const harga\s*=\s*\(price === 0 \|\| price\) \?/);
  assert.doesNotMatch(waNotif, /const harga\s*=\s*price \? /);
});

test('the client-side eligibility gate is written identically at both its call sites, so a future edit cannot desync them', () => {
  // Regression guard for test-coverage: the differential test in
  // booking-discount-preview.test.js only proves the *discount math* stays
  // in sync between server and client — it does not touch the *eligibility*
  // expression, which is independently duplicated in updateSidebar() and
  // the pre-submit confirm-box renderer. This test at least pins those two
  // client copies to each other and to the exclusion set the server enforces.
  const bookingJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'booking.js'), 'utf8');
  const gateExpr = "memberBenefitContext && !isGroup() && !isWeddingPackage && !isHomeService && state.service && total > 0";
  const occurrences = bookingJs.split(gateExpr).length - 1;
  assert.equal(occurrences, 2, `expected the exact eligibility expression to appear at both client call sites (sidebar + confirm box), found ${occurrences}`);

  // Same three exclusions (wedding, home service, group) the server enforces.
  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /isWeddingBooking/);
  assert.match(routeBody, /bookingType !== 'home_service'/);
  assert.match(routeBody, /isGroupBooking/);
});
