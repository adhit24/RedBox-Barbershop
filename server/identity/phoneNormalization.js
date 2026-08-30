'use strict';

/**
 * Bounded, side-effect-free E.164-style phone normalization shared by the
 * WhatsApp trusted-identity issuer (inbound, trustedIdentity.js) and the
 * Fonnte outbound sender (fonnte.js). Accepts realistic international
 * numbers in addition to the Indonesian 08-prefixed local convenience form.
 * Never infers or returns anything about language or country beyond the
 * digits themselves — callers must not use this to decide response language.
 */

// Optional single leading '+', otherwise digits/spaces/parens/dashes only.
// A second '+', a '+' not in leading position, letters, or '@' all fail this.
const SAFE_PHONE_CHARACTERS = /^\+?[0-9\s()-]+$/;

// Indonesian local convenience: "081234567890" (08 + 8-11 more digits).
const LOCAL_ID_PHONE_PATTERN = /^08\d{8,11}$/;

// Bounded realistic E.164 shape: 8-15 total digits, no leading zero (E.164
// country codes never start with 0). Covers 62xxxxxxxxxx (Indonesia, with
// or without leading +), and any other country code (65/60/1/44/81/82/...).
const E164_DIGITS_PATTERN = /^[1-9]\d{7,14}$/;

function normalizePhoneNumber(value) {
  if (typeof value !== 'string' || !SAFE_PHONE_CHARACTERS.test(value)) return null;
  const compact = value.replace(/[\s()-]/g, '');
  const hasPlus = compact.startsWith('+');
  const digits = hasPlus ? compact.slice(1) : compact;

  if (!hasPlus && LOCAL_ID_PHONE_PATTERN.test(digits)) {
    return `62${digits.slice(1)}`;
  }
  if (E164_DIGITS_PATTERN.test(digits)) {
    return digits;
  }
  return null;
}

module.exports = {
  normalizePhoneNumber,
  SAFE_PHONE_CHARACTERS,
  LOCAL_ID_PHONE_PATTERN,
  E164_DIGITS_PATTERN,
};
