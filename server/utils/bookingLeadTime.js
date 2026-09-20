'use strict';

const crypto = require('crypto');
const helper = require('../../public/js/booking-lead-time.js');

/**
 * Safely verify if provided admin token matches configured ADMIN_PASSWORD.
 *
 * Requirements:
 * - Constant-time comparison via crypto.timingSafeEqual on SHA-256 digests.
 * - If configuredSecret is empty, whitespace, or not set -> returns false.
 * - If providedToken is empty, whitespace, or not a string -> returns false.
 * - Only returns true if providedToken matches configuredSecret.
 *
 * @param {*} providedToken
 * @param {*} configuredSecret
 * @returns {boolean}
 */
function safeAdminTokenMatch(providedToken, configuredSecret) {
  const secret = typeof configuredSecret === 'string' ? configuredSecret.trim() : '';
  const token = typeof providedToken === 'string' ? providedToken.trim() : '';
  if (!secret || !token) return false;
  try {
    const digest = (v) => crypto.createHash('sha256').update(v, 'utf8').digest();
    return crypto.timingSafeEqual(digest(token), digest(secret));
  } catch {
    return false;
  }
}

module.exports = {
  ...helper,
  safeAdminTokenMatch,
};
