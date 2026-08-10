'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.join(__dirname, '..', 'migrations', '2026-08-10-booking-discount-columns.sql');

test('booking discount columns migration adds nullable original_price and discount_label to bookings', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /ALTER TABLE (?:public\.)?bookings ADD COLUMN IF NOT EXISTS original_price INTEGER/i);
  assert.match(sql, /ALTER TABLE (?:public\.)?bookings ADD COLUMN IF NOT EXISTS discount_label TEXT/i);
  assert.doesNotMatch(sql, /NOT NULL/i);
});
