'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const bookingJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'booking.js'), 'utf8');
const bookingHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'booking.html'), 'utf8');

test('step2Ready no longer requires the two people to have different kapster', () => {
  const fnMatch = bookingJs.match(/function step2Ready\(\)\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(fnMatch, 'expected to find step2Ready()');
  assert.doesNotMatch(fnMatch[0], /must be different kapster/);
  assert.doesNotMatch(fnMatch[0], /state\.barber\.id\)\s*===\s*String\(state\.person2\.barber\.id\)/);
});

test('step2Ready still requires the two people to be in the same branch', () => {
  const fnMatch = bookingJs.match(/function step2Ready\(\)\s*\{[\s\S]*?\n\s*\}/);
  assert.match(fnMatch[0], /state\.barber\.branch\s*!==\s*state\.person2\.barber\.branch/);
});

test('the kapster-card click handler no longer blocks picking the same kapster for both people', () => {
  assert.doesNotMatch(bookingJs, /Kapster ini sudah dipilih untuk orang yang lain/);
});
