'use strict';

const BIRTHDAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const BIRTHDAY_DISCOUNT_PERCENT = 50;
const GOLD_GENERAL_DISCOUNT_PERCENT = 10;
const GENTLEMAN_GROOMING_SERVICE_ID = 'gentleman-grooming';
const CSB_LOCATION = 'csb';
// Real price of Gentleman Grooming is Rp95.000 (standard branches) or
// Rp120.000 (CSB Mall) — see public/js/services-data.js REDBOX_SERVICES.
// The Platinum "free grooming" benefit must never be worth more than the
// real service, even if a client submits a mismatched service_id/price
// pair (e.g. claiming grooming while actually booking a pricier service).
// We cap at the higher of the two known prices rather than threading
// branch-specific logic through this rule.
const GENTLEMAN_GROOMING_MAX_PRICE = 120000;

function isWithinBirthdayWindow(bookingDateStr, birthdateStr) {
  if (!bookingDateStr || !birthdateStr) return false;
  const booking = new Date(`${bookingDateStr}T00:00:00Z`);
  const birth = new Date(`${birthdateStr}T00:00:00Z`);
  if (Number.isNaN(booking.getTime()) || Number.isNaN(birth.getTime())) return false;
  const bookingYear = booking.getUTCFullYear();
  const candidates = [bookingYear - 1, bookingYear, bookingYear + 1].map(year =>
    Date.UTC(year, birth.getUTCMonth(), birth.getUTCDate())
  );
  return candidates.some(bdayMs => Math.abs(booking.getTime() - bdayMs) <= BIRTHDAY_WINDOW_MS);
}

function noDiscount(basePrice) {
  return { discountPercent: 0, discountAmount: 0, finalPrice: basePrice, benefitLabel: null };
}

function applyPercent(basePrice, percent, label) {
  const discountAmount = Math.round(basePrice * (percent / 100));
  return {
    discountPercent: percent,
    discountAmount,
    finalPrice: basePrice - discountAmount,
    benefitLabel: label,
  };
}

// Platinum's "free Gentleman Grooming" benefit — capped at the real service
// price so a spoofed/mismatched service_id + inflated basePrice can't turn
// an unrelated, pricier service fully free.
function applyGroomingFree(basePrice, label) {
  const discountAmount = Math.min(basePrice, GENTLEMAN_GROOMING_MAX_PRICE);
  return {
    discountPercent: basePrice > 0 ? Math.round((discountAmount / basePrice) * 100) : 100,
    discountAmount,
    finalPrice: basePrice - discountAmount,
    benefitLabel: label,
  };
}

function bestOf(candidates, basePrice) {
  const real = candidates.filter(Boolean);
  if (!real.length) return noDiscount(basePrice);
  return real.reduce((best, c) => (c.discountAmount > best.discountAmount ? c : best));
}

function computeServiceDiscount({ tier, membershipActive, birthdate, serviceId, location, bookingDate, basePrice }) {
  const price = Number(basePrice) || 0;
  if (!membershipActive) return noDiscount(price);

  const normalizedTier = String(tier || '').trim().toLowerCase();
  const birthdayCandidate = isWithinBirthdayWindow(bookingDate, birthdate)
    ? applyPercent(price, BIRTHDAY_DISCOUNT_PERCENT, 'Diskon Ulang Tahun 50%')
    : null;

  if (normalizedTier === 'silver') {
    return birthdayCandidate || noDiscount(price);
  }

  if (normalizedTier === 'gold') {
    const isCsb = String(location || '').trim().toLowerCase() === CSB_LOCATION;
    const generalCandidate = isCsb ? null : applyPercent(price, GOLD_GENERAL_DISCOUNT_PERCENT, 'Diskon Gold 10%');
    return bestOf([birthdayCandidate, generalCandidate], price);
  }

  if (normalizedTier === 'platinum') {
    const isGrooming = String(serviceId || '').trim().toLowerCase() === GENTLEMAN_GROOMING_SERVICE_ID;
    const groomingCandidate = isGrooming ? applyGroomingFree(price, 'Gratis — Benefit Platinum') : null;
    return bestOf([birthdayCandidate, groomingCandidate], price);
  }

  return noDiscount(price);
}

module.exports = { computeServiceDiscount, isWithinBirthdayWindow };
