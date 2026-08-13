'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { timeRangesOverlap } = require('../../public/js/booking-time-overlap.js');

test('non-overlapping ranges (B starts exactly when A ends) do not overlap', () => {
  // 10:00 (600min) + 30min duration ends at 10:30; B starts at 10:30
  assert.equal(timeRangesOverlap(600, 30, 630, 30), false);
});

test('ranges that share any minute overlap', () => {
  // A: 10:00-10:45, B: 10:30-11:00 -> overlap
  assert.equal(timeRangesOverlap(600, 45, 630, 30), true);
});

test('identical start times always overlap regardless of duration', () => {
  assert.equal(timeRangesOverlap(660, 30, 660, 30), true);
});

test('B fully contained inside A overlaps', () => {
  // A: 10:00-12:00, B: 10:30-10:45
  assert.equal(timeRangesOverlap(600, 120, 630, 15), true);
});

test('B entirely before A does not overlap', () => {
  // A: 11:00-11:30, B: 09:00-09:30
  assert.equal(timeRangesOverlap(660, 30, 540, 30), false);
});

test('module also exposes itself as a global for the browser UMD pattern', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'public', 'js', 'booking-time-overlap.js'),
    'utf8'
  );
  assert.match(src, /root\.RedboxBookingOverlap = api/);
});
