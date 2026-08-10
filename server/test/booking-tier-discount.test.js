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
  assert.match(routeBody, /if \(!isAdmin && bookingType !== 'wedding' && bookingType !== 'home_service' && !isGroupBooking\)/);
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
