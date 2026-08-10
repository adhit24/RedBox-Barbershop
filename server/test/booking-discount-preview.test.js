'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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
