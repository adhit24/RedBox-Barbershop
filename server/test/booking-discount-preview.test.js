'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { computeServiceDiscount } = require('../membership-benefits');

const workspace = path.join(__dirname, '..', '..', 'public');
// Normalize CRLF -> LF: this checkout has CRLF line endings, and some of
// the regexes below anchor on a bare "\n" immediately after content (e.g.
// right after a closing brace). On CRLF that character is "\r", not "\n",
// so without normalizing here those regexes would never match regardless
// of what the source file actually contains.
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8').replace(/\r\n/g, '\n');

test('booking.html has sidebar markup for the discount badge and struck-through original price', () => {
  const html = source('booking.html');
  assert.match(html, /id="sumDiscountRow"/);
  assert.match(html, /id="sumDiscountBadge"/);
  assert.match(html, /id="sumTotalOriginal"/);
});

test('booking.css styles the discount badge and struck-through original price', () => {
  const css = source('css/booking.css');
  assert.match(css, /\.sb-discount-badge\s*\{/);
  assert.match(css, /\.sb-total-original\s*\{[^}]*text-decoration:\s*line-through/);
});

test('booking.js fetches the member context from /api/auth/me when a member token exists', () => {
  const js = source('js/booking.js');
  assert.match(js, /let memberBenefitContext = null;/);
  assert.match(js, /localStorage\.getItem\('rb_member_token'\)/);
  assert.match(js, /fetch\(API_URL \+ '\/auth\/me'/);
});

test('booking.js defines a client-side mirror of the tier-discount rules', () => {
  const js = source('js/booking.js');
  assert.match(js, /function isWithinBirthdayWindow\(/);
  assert.match(js, /function computeServiceDiscountPreview\(/);
  assert.match(js, /'Diskon Gold 10%'/);
  assert.match(js, /'Gratis — Benefit Platinum'/);
});

test('updateSidebar renders the discount preview only for eligible (non-group, non-wedding) solo bookings', () => {
  const js = source('js/booking.js');
  // updateSidebar() contains its own standalone "}" lines from nested
  // if/else blocks at this file's flat one-space indentation, so a lazy
  // match on the first "\n }\n" would truncate early. Anchor on the next
  // sibling top-level function declaration instead, which is a much rarer,
  // reliable boundary in this file.
  const fnMatch = js.match(/function updateSidebar\(\)[\s\S]*?\n function setBranchActive/);
  assert.ok(fnMatch, 'expected to find updateSidebar() up to the next function declaration');
  const fnBody = fnMatch[0];
  assert.match(fnBody, /computeServiceDiscountPreview\(/);
  assert.match(fnBody, /isGroup\(\)/);
  assert.match(fnBody, /sumDiscountRow/);
  assert.match(fnBody, /sumTotalOriginal/);
});

test('_buildPayloadFor sends an explicit group boolean instead of relying on notes parsing', () => {
  const js = source('js/booking.js');
  const fnMatch = js.match(/function _buildPayloadFor\([\s\S]*?\n \}\n/);
  assert.ok(fnMatch, 'expected to find _buildPayloadFor()');
  assert.match(fnMatch[0], /group:\s*isGroup\(\)/);
});

test('computeServiceDiscountPreview caps the Platinum grooming benefit the same way server/membership-benefits.js does, instead of always showing 100% off / Rp0', () => {
  const js = source('js/booking.js');
  // Pull out just the "TIER DISCOUNT PREVIEW" block (both helper functions
  // plus the GENTLEMAN_GROOMING_MAX_PRICE constant) and execute it for
  // real in an isolated VM context, so this test exercises the actual
  // discount math rather than only asserting a constant's presence via
  // regex. Bounded by its own section comment through the next section
  // comment ("── SIDEBAR"), which immediately follows it in the file.
  const blockMatch = js.match(/\/\/ ── TIER DISCOUNT PREVIEW[\s\S]*?\/\/ ── SIDEBAR/);
  assert.ok(blockMatch, 'expected to find the TIER DISCOUNT PREVIEW block');
  const block = blockMatch[0].replace(/\/\/ ── SIDEBAR[\s\S]*$/, '');

  const context = {};
  vm.createContext(context);
  vm.runInContext(block, context);
  assert.strictEqual(typeof context.computeServiceDiscountPreview, 'function');

  // Gentleman Grooming + Hair Spa add-on: real basePrice (Rp205.000) is
  // above the Rp120.000 cap. Must NOT be shown as fully free.
  const overCap = context.computeServiceDiscountPreview({
    tier: 'platinum',
    membershipActive: true,
    birthdate: null,
    serviceId: 'gentleman-grooming',
    location: 'menteng',
    bookingDate: '2026-08-10',
    basePrice: 205000,
  });
  assert.notStrictEqual(overCap.discountPercent, 100);
  assert.strictEqual(overCap.discountAmount, 120000);
  assert.strictEqual(overCap.finalPrice, 85000);
  // finalPrice is non-zero here (customer is still charged Rp85.000), so the
  // label must not claim the booking is free — see server/membership-benefits.js's
  // applyGroomingFree, which picks the label based on whether finalPrice is 0.
  assert.strictEqual(overCap.benefitLabel, 'Potongan Benefit Platinum Rp120.000');

  // Plain Gentleman Grooming with no add-ons (Rp95.000) stays under the
  // cap and is still fully free, matching the server's uncapped case.
  const underCap = context.computeServiceDiscountPreview({
    tier: 'platinum',
    membershipActive: true,
    birthdate: null,
    serviceId: 'gentleman-grooming',
    location: 'menteng',
    bookingDate: '2026-08-10',
    basePrice: 95000,
  });
  assert.strictEqual(underCap.discountPercent, 100);
  assert.strictEqual(underCap.discountAmount, 95000);
  assert.strictEqual(underCap.finalPrice, 0);
});

test('computeServiceDiscount (server) and computeServiceDiscountPreview (client) agree across a matrix of tier/membership/birthday/service/location/price combinations', () => {
  const js = source('js/booking.js');
  const blockMatch = js.match(/\/\/ ── TIER DISCOUNT PREVIEW[\s\S]*?\/\/ ── SIDEBAR/);
  assert.ok(blockMatch, 'expected to find the TIER DISCOUNT PREVIEW block');
  const block = blockMatch[0].replace(/\/\/ ── SIDEBAR[\s\S]*$/, '');

  const context = {};
  vm.createContext(context);
  vm.runInContext(block, context);
  assert.strictEqual(typeof context.computeServiceDiscountPreview, 'function');

  const bookingDate = '2026-08-10';
  const tiers = ['bronze', 'silver', 'gold', 'platinum'];
  const membershipActiveOptions = [true, false];
  // '1990-08-10' lands exactly on the booking date -> inside the birthday
  // window. '1990-01-01' is nowhere near it -> outside the window.
  const birthdates = ['1990-08-10', '1990-01-01'];
  const serviceIds = ['gentleman-grooming', 'hair-color'];
  const locations = ['csb', 'bypass'];
  // One basePrice below the Rp120.000 grooming cap, one above it.
  const basePrices = [90000, 200000];

  let combos = 0;
  for (const tier of tiers) {
    for (const membershipActive of membershipActiveOptions) {
      for (const birthdate of birthdates) {
        for (const serviceId of serviceIds) {
          for (const location of locations) {
            for (const basePrice of basePrices) {
              const input = { tier, membershipActive, birthdate, serviceId, location, bookingDate, basePrice };
              const serverResult = computeServiceDiscount(input);
              const clientResult = context.computeServiceDiscountPreview(input);
              // clientResult is an object from the vm context's own realm (a
              // different Object/Array constructor than the host realm), so
              // assert.deepEqual would fail on prototype identity alone even
              // when every value matches. Round-trip both through JSON first
              // to compare plain host-realm values only.
              const serverPlain = JSON.parse(JSON.stringify(serverResult));
              const clientPlain = JSON.parse(JSON.stringify(clientResult));
              assert.deepEqual(
                clientPlain,
                serverPlain,
                `mismatch for ${JSON.stringify(input)}: server=${JSON.stringify(serverPlain)} client=${JSON.stringify(clientPlain)}`
              );
              combos++;
            }
          }
        }
      }
    }
  }
  // Sanity check that the matrix actually ran (4*2*2*2*2*2 = 128 combos).
  assert.strictEqual(combos, 128);
});
