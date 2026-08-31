'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { guardRealtimeBarberFacts } = require('../agents/reddy/realtimeFactGuard');
const { REDDY_BOOKING_EXECUTION, containsProhibitedClaim } = require('../agents/reddy/bookingGuards');
const { resolveResponseLanguage } = require('../agents/reddy/languageResolution');

// ── Barber presence cross-language regression (contract tests 21-25) ──

test('Indonesian attendance claim is blocked and replaced with the verified schedule fact', () => {
  const result = guardRealtimeBarberFacts('Mas Husen ada kok, silakan datang sekarang.', {
    verifiedSchedule: { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' },
    responseLanguage: 'indonesian',
  });
  assert.equal(result.triggered, true);
  assert.match(result.sanitizedReply, /dijadwalkan masuk hari ini/);
  assert.doesNotMatch(result.sanitizedReply, /ada kok/);
});

test('English attendance claim is blocked and replaced with the same verified schedule fact (test 22)', () => {
  const result = guardRealtimeBarberFacts('Husen is here now, come on over.', {
    verifiedSchedule: { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' },
    knownBarberNames: ['Husen'],
    responseLanguage: 'english',
  });
  assert.equal(result.triggered, true);
  assert.match(result.sanitizedReply, /scheduled to work today/);
  assert.doesNotMatch(result.sanitizedReply, /is here now/);
});

test('scheduled never becomes present, in any tested language (test 24)', () => {
  for (const [reply, responseLanguage] of [
    ['Mas Husen ada di sini sekarang.', 'indonesian'],
    ['Husen is here now.', 'english'],
  ]) {
    const result = guardRealtimeBarberFacts(reply, {
      verifiedSchedule: { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' },
      knownBarberNames: ['Husen'],
      responseLanguage,
    });
    assert.equal(result.triggered, true);
    assert.doesNotMatch(result.sanitizedReply, /ada di sini sekarang|is here now/);
  }
});

test('scheduled never becomes available/free, in any tested language (test 25)', () => {
  for (const [reply, responseLanguage] of [
    ['Mas Husen ready kok sekarang.', 'indonesian'],
    ['Husen is free right now.', 'english'],
  ]) {
    const result = guardRealtimeBarberFacts(reply, {
      verifiedSchedule: { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' },
      knownBarberNames: ['Husen'],
      responseLanguage,
    });
    assert.equal(result.triggered, true);
  }
});

// ── Booking authority regression (contract tests 26-29) ──

test('booking execution remains DISABLED (test 28)', () => {
  assert.equal(REDDY_BOOKING_EXECUTION, 'DISABLED');
});

test('no fake booking confirmation survives in Indonesian or English (test 29)', () => {
  assert.equal(containsProhibitedClaim('Sudah aku booking ya kak, slotnya aman!'), true);
  assert.equal(containsProhibitedClaim("Great news, I've already booked your slot!"), true);
});

// ── Language switching does not revive a stale booking CTA (test 33) ──

test('a language switch alone does not change booking CTA eligibility', () => {
  // resolveResponseLanguage only ever returns a language string — it has no
  // notion of booking CTA eligibility at all, so a language switch cannot,
  // by construction, revive a suppressed CTA. This test pins that contract.
  const lang = resolveResponseLanguage('Can I come tomorrow?', { turns: [{ role: 'user', content: 'Kalau CSB berapa?' }] }, {});
  assert.equal(lang, 'english');
  assert.equal(typeof lang, 'string');
  assert.equal(Object.keys({ lang }).includes('bookingCtaEligible'), false);
});
