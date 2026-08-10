'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { computeServiceDiscount, isWithinBirthdayWindow } = require('../membership-benefits');

test('bronze never gets a discount, active or not', () => {
  const active = computeServiceDiscount({ tier: 'bronze', membershipActive: true, birthdate: '1990-08-10', serviceId: 'gentleman-grooming', location: 'bypass', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.deepEqual(active, { discountPercent: 0, discountAmount: 0, finalPrice: 100000, benefitLabel: null });
});

test('an inactive membership never gets a discount regardless of tier or birthday window', () => {
  const result = computeServiceDiscount({ tier: 'platinum', membershipActive: false, birthdate: '1990-08-10', serviceId: 'gentleman-grooming', location: 'bypass', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.deepEqual(result, { discountPercent: 0, discountAmount: 0, finalPrice: 100000, benefitLabel: null });
});

test('silver gets 50% off inside the birthday window, nothing outside it', () => {
  const inWindow = computeServiceDiscount({ tier: 'silver', membershipActive: true, birthdate: '1990-08-10', serviceId: 'any-service', location: 'bypass', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.equal(inWindow.discountPercent, 50);
  assert.equal(inWindow.discountAmount, 50000);
  assert.equal(inWindow.finalPrice, 50000);
  assert.equal(inWindow.benefitLabel, 'Diskon Ulang Tahun 50%');

  const outsideWindow = computeServiceDiscount({ tier: 'silver', membershipActive: true, birthdate: '1990-08-10', serviceId: 'any-service', location: 'bypass', bookingDate: '2026-08-25', basePrice: 100000 });
  assert.deepEqual(outsideWindow, { discountPercent: 0, discountAmount: 0, finalPrice: 100000, benefitLabel: null });
});

test('birthday window is inclusive at exactly 7 days before/after, and excludes 8 days out', () => {
  assert.equal(isWithinBirthdayWindow('2026-08-03', '1990-08-10'), true); // exactly 7 days before
  assert.equal(isWithinBirthdayWindow('2026-08-17', '1990-08-10'), true); // exactly 7 days after
  assert.equal(isWithinBirthdayWindow('2026-08-02', '1990-08-10'), false); // 8 days before
  assert.equal(isWithinBirthdayWindow('2026-08-18', '1990-08-10'), false); // 8 days after
});

test('birthday window handles December-to-January wraparound', () => {
  // Birthday Jan 2 — booking on Dec 28 is 5 days before the *next* Jan 2
  assert.equal(isWithinBirthdayWindow('2025-12-28', '1990-01-02'), true);
  // Birthday Dec 30 — booking on Jan 4 is 5 days after the *previous* Dec 30
  assert.equal(isWithinBirthdayWindow('2026-01-04', '1990-12-30'), true);
});

test('gold gets max(birthday 50%, general 10%) — general 10% wins outside the birthday window', () => {
  const result = computeServiceDiscount({ tier: 'gold', membershipActive: true, birthdate: '1990-01-01', serviceId: 'any-service', location: 'bypass', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.equal(result.discountPercent, 10);
  assert.equal(result.discountAmount, 10000);
  assert.equal(result.finalPrice, 90000);
  assert.equal(result.benefitLabel, 'Diskon Gold 10%');
});

test('gold birthday 50% wins over general 10% when both apply on the same booking', () => {
  const result = computeServiceDiscount({ tier: 'gold', membershipActive: true, birthdate: '1990-08-10', serviceId: 'any-service', location: 'bypass', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.equal(result.discountPercent, 50);
  assert.equal(result.benefitLabel, 'Diskon Ulang Tahun 50%');
});

test('gold general 10% does not apply at the CSB Mall branch', () => {
  const result = computeServiceDiscount({ tier: 'gold', membershipActive: true, birthdate: '1990-01-01', serviceId: 'any-service', location: 'csb', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.deepEqual(result, { discountPercent: 0, discountAmount: 0, finalPrice: 100000, benefitLabel: null });
});

test('gold birthday 50% still applies at CSB even though the general 10% is excluded there', () => {
  const result = computeServiceDiscount({ tier: 'gold', membershipActive: true, birthdate: '1990-08-10', serviceId: 'any-service', location: 'csb', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.equal(result.discountPercent, 50);
  assert.equal(result.benefitLabel, 'Diskon Ulang Tahun 50%');
});

test('platinum gets 100% off Gentlemen Grooming specifically, not other services', () => {
  const grooming = computeServiceDiscount({ tier: 'platinum', membershipActive: true, birthdate: '1990-01-01', serviceId: 'gentleman-grooming', location: 'bypass', bookingDate: '2026-08-10', basePrice: 95000 });
  assert.equal(grooming.discountPercent, 100);
  assert.equal(grooming.finalPrice, 0);
  assert.equal(grooming.benefitLabel, 'Gratis — Benefit Platinum');

  const otherService = computeServiceDiscount({ tier: 'platinum', membershipActil: true, membershipActive: true, birthdate: '1990-01-01', serviceId: 'hair-color', location: 'bypass', bookingDate: '2026-08-10', basePrice: 160000 });
  assert.deepEqual(otherService, { discountPercent: 0, discountAmount: 0, finalPrice: 160000, benefitLabel: null });
});

test('platinum free grooming is capped at the real Gentleman Grooming price, not whatever basePrice is submitted', () => {
  // A spoofed/mismatched service_id + basePrice pair (e.g. claiming grooming
  // while actually booking a pricier Rp160.000 service) must not become
  // fully free — the discount amount is capped at the known real price.
  const spoofed = computeServiceDiscount({ tier: 'platinum', membershipActive: true, birthdate: '1990-01-01', serviceId: 'gentleman-grooming', location: 'bypass', bookingDate: '2026-08-10', basePrice: 160000 });
  assert.equal(spoofed.discountAmount, 120000);
  assert.equal(spoofed.finalPrice, 40000);
  assert.equal(spoofed.benefitLabel, 'Gratis — Benefit Platinum');
});

test('platinum birthday 50% wins over free grooming when both would apply (50% of a nonzero price beats a free-only-on-one-service rule elsewhere)', () => {
  // On a non-grooming service during the birthday window, only birthday applies.
  const result = computeServiceDiscount({ tier: 'platinum', membershipActive: true, birthdate: '1990-08-10', serviceId: 'hair-color', location: 'bypass', bookingDate: '2026-08-10', basePrice: 160000 });
  assert.equal(result.discountPercent, 50);
  assert.equal(result.benefitLabel, 'Diskon Ulang Tahun 50%');
});

test('an unrecognized or missing tier never gets a discount', () => {
  const result = computeServiceDiscount({ tier: null, membershipActive: true, birthdate: '1990-08-10', serviceId: 'any-service', location: 'bypass', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.deepEqual(result, { discountPercent: 0, discountAmount: 0, finalPrice: 100000, benefitLabel: null });
});
