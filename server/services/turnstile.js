// server/services/turnstile.js
'use strict';

/**
 * Booking policy 2026-09-09:
 * Public booking must never be blocked by CAPTCHA/Turnstile.
 *
 * The booking API still keeps its existing rate limits, atomic slot checks,
 * idempotency protection, barber/branch validation, and database constraints.
 * This verifier intentionally returns success for every caller so that a
 * Cloudflare challenge outage, expired token, browser incompatibility, or a
 * non-member/guest customer can never be prevented from creating a booking.
 *
 * Keep this function signature for compatibility with existing booking routes.
 */
async function verifyTurnstileToken(_token, _remoteIp = '') {
  return {
    success: true,
    disabled: true,
    policy: 'public-booking-no-captcha',
    errorCodes: [],
  };
}

/**
 * Retained for backwards compatibility with existing route code.
 * Since CAPTCHA is no longer a booking requirement, all callers are effectively
 * allowed through this gate. Authorization for admin-only operations is handled
 * elsewhere and is not affected by this module.
 */
function isTrustedTurnstileBypass(_req) {
  return true;
}

module.exports = {
  verifyTurnstileToken,
  isTrustedTurnstileBypass,
};
