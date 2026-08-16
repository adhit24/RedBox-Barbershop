'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const bookingSource = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'booking.js'), 'utf8');

test('booking page forwards the OTP member session to the booking API', () => {
  assert.match(bookingSource, /localStorage\.getItem\('rb_member_token'\)/);
  assert.ok(bookingSource.includes('requestHeaders.Authorization'), 'booking request must set Authorization');
  assert.ok(bookingSource.includes("'Bearer ' + memberToken"), 'booking request must use the OTP token');
  assert.ok(bookingSource.includes('headers: requestHeaders'), 'booking request must send the constructed headers');
});

test('active member identity guard runs before server-side discount calculation', () => {
  const routeStart = serverSource.indexOf("app.post('/api/bookings'");
  const discountBlockStart = serverSource.indexOf('const discount = computeServiceDiscount({', routeStart);
  const sessionGuardStart = serverSource.indexOf("code: 'MEMBER_LOGIN_REQUIRED'", routeStart);
  const nameGuardStart = serverSource.indexOf("code: 'MEMBER_IDENTITY_MISMATCH'", routeStart);

  assert.ok(routeStart >= 0, 'booking route must exist');
  assert.ok(sessionGuardStart > routeStart, 'session guard must be inside the booking route');
  assert.ok(nameGuardStart > routeStart, 'name guard must be inside the booking route');
  assert.ok(discountBlockStart > nameGuardStart, 'discount must not be calculated before identity validation');
  assert.match(serverSource.slice(routeStart, discountBlockStart), /requiresMemberIdentity/);
  assert.match(serverSource.slice(routeStart, discountBlockStart), /\['silver', 'gold', 'platinum'\]\.includes\(memberTier\)/);
  assert.match(serverSource.slice(routeStart, discountBlockStart), /sameIdentityPhone\(memberSession\?\.customer_wa, wa\)/);
  assert.match(serverSource.slice(routeStart, discountBlockStart), /sameIdentityName\(name, memberProfile\?\.full_name\)/);
});

test('identity protection is limited to active Silver, Gold, and Platinum tiers', () => {
  const routeStart = serverSource.indexOf("app.post('/api/bookings'");
  const discountBlockStart = serverSource.indexOf('const discount = computeServiceDiscount({', routeStart);
  const block = serverSource.slice(routeStart, discountBlockStart);
  assert.match(block, /const memberTier = resolveMembershipTier\(memberProfile\?\.current_tier\)/);
  assert.match(block, /const requiresMemberIdentity = memberActive/);
  assert.match(block, /\['silver', 'gold', 'platinum'\]\.includes\(memberTier\)/);
  assert.doesNotMatch(block, /\['bronze', 'silver', 'gold', 'platinum'\]\.includes\(memberTier\)/);
});

test('group bookings remain excluded from personal membership discount logic', () => {
  const routeStart = serverSource.indexOf("app.post('/api/bookings'");
  const gateStart = serverSource.indexOf('if (!isAdmin && !isWeddingBooking', routeStart);
  assert.ok(gateStart > routeStart, 'discount eligibility gate must exist');
  assert.match(serverSource.slice(gateStart, gateStart + 260), /!isGroupBooking/);
});
