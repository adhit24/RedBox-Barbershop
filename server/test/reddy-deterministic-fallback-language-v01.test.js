'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const webhookPath = path.resolve(__dirname, '../../api/wa/webhook.js');
const { fallbackReply } = require(webhookPath);
const { guardReddyReply, containsProhibitedClaim, containsUnverifiedAvailabilityClaim } = require('../agents/reddy/bookingGuards');

test('fallbackReply: generic fallback is English for an English customer (objective 7)', () => {
  const idReply = fallbackReply('asdkjfh random text', 'Bob', 'bypass', null, 'indonesian');
  const enReply = fallbackReply('asdkjfh random text', 'Bob', 'bypass', null, 'english');
  assert.match(idReply, /Mohon maaf/);
  assert.doesNotMatch(enReply, /Mohon maaf|Kak/);
  assert.match(enReply, /Bob|sorry|apologize|Sorry/i);
});

test('fallbackReply: knowledge-unavailable guard is English for an English customer', () => {
  const enReply = fallbackReply('what is the price of a royal grooming package', 'Bob', 'bypass', 'unavailable', 'english');
  assert.doesNotMatch(enReply, /Maaf Kak|terverifikasi/);
});

test('fallbackReply: default (no responseLanguage passed) stays Indonesian (backward compatible)', () => {
  const reply = fallbackReply('halo', 'Bob');
  assert.match(reply, /Halo/);
});

test('bookingGuards: English fake-booking-confirmation claim is caught (objective 6/objective 7, test 29)', () => {
  assert.equal(containsProhibitedClaim("Yes, I've already booked it for you!"), true);
  assert.equal(containsProhibitedClaim('Your booking is confirmed for 3pm.'), true);
  assert.equal(containsProhibitedClaim('I have rescheduled your appointment.'), true);
});

test('bookingGuards: English unverified-availability claim is caught', () => {
  assert.equal(containsUnverifiedAvailabilityClaim('The slot at 3pm is still available.'), true);
});

test('bookingGuards: ordinary English informational text is not falsely blocked (test 32)', () => {
  assert.equal(containsProhibitedClaim('You can book online at redboxbarbershop.com.'), false);
  assert.equal(containsUnverifiedAvailabilityClaim('Our hours are 10am to 9pm.'), false);
});

test('guardReddyReply: correction text is English for an English customer (test 30-31 pairing)', () => {
  const en = guardReddyReply("Yes, I've already booked it for you!", {
    isBackendVerified: false, bookingUrl: 'https://redboxbarbershop.com/booking.html', bookingCtaEligible: true, responseLanguage: 'english',
  });
  assert.equal(en.blockedProhibitedClaim, true);
  assert.match(en.sanitizedReply, /booking|website/i);
  assert.doesNotMatch(en.sanitizedReply, /Kak|belum dibuat/);

  const id = guardReddyReply('Sudah aku booking ya kak!', {
    isBackendVerified: false, bookingUrl: 'https://redboxbarbershop.com/booking.html', bookingCtaEligible: true, responseLanguage: 'indonesian',
  });
  assert.equal(id.blockedProhibitedClaim, true);
  assert.match(id.sanitizedReply, /Kak/);
});

test('guardReddyReply: default responseLanguage stays Indonesian (backward compatible)', () => {
  const result = guardReddyReply('Sudah aku booking ya kak!', {
    isBackendVerified: false, bookingUrl: 'https://redboxbarbershop.com/booking.html', bookingCtaEligible: true,
  });
  assert.match(result.sanitizedReply, /Kak/);
});
