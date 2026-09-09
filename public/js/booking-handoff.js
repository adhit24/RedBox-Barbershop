(function bookingHandoffModule(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RedboxBookingHandoff = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function bookingHandoffFactory(root) {
  'use strict';

  const VALID_BRANCHES = new Set(['bypass', 'samadikun', 'csb', 'sumber', 'tegal']);

  // HOTFIX 2026-09-09 — Cloudflare Turnstile tokens are single-use.
  // public/js/booking.js currently calls the verification Worker first and then
  // sends the SAME token to /api/bookings, where it is verified again. The first
  // verification consumes the token, so the authoritative booking API rejects it
  // with HTTP 403 as "expired/duplicate". Keep the server as the only verifier.
  //
  // This compatibility shim short-circuits only the obsolete browser-side
  // verification request. It does NOT bypass booking security: the untouched token
  // is still sent to /api/bookings or /api/bookings/group and must pass the
  // server-side Turnstile gate before a booking can be written.
  const LEGACY_TURNSTILE_VERIFY_URL = 'https://turnstile-siteverify-redbox-booking.adhit24.workers.dev';
  if (root && typeof root.fetch === 'function' && !root.__rbTurnstileSingleUseHotfix) {
    const nativeFetch = root.fetch.bind(root);
    root.fetch = function redboxFetchWithTurnstileSingleUseFix(input, init) {
      const url = typeof input === 'string'
        ? input
        : (input && typeof input.url === 'string' ? input.url : '');

      if (url === LEGACY_TURNSTILE_VERIFY_URL) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          delegated_to_booking_api: true,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }

      return nativeFetch(input, init);
    };
    root.__rbTurnstileSingleUseHotfix = true;
  }

  function isValidIsoDate(value) {
    const match = /^(20\d{2})-(0[1-9]|1[0-2])-([012]\d|3[01])$/.exec(value);
    if (!match) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1])
      && date.getUTCMonth() === Number(match[2]) - 1
      && date.getUTCDate() === Number(match[3]);
  }

  function parseBookingHandoff(search) {
    const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const branch = String(params.get('branch') || '').trim().toLowerCase();
    const serviceId = String(params.get('service_id') || params.get('service') || '').trim().toLowerCase();
    const barberId = String(params.get('barber_id') || params.get('barber') || '').trim();
    const date = String(params.get('date') || '').trim();
    const time = String(params.get('time') || '').trim();
    const timePreference = String(params.get('time_preference') || '').trim().toLowerCase();

    return {
      branch: VALID_BRANCHES.has(branch) ? branch : null,
      service_id: /^[a-z0-9][a-z0-9-]*$/.test(serviceId) ? serviceId : null,
      barber_id: /^[A-Za-z0-9_-]+$/.test(barberId) ? barberId : null,
      date: isValidIsoDate(date) ? date : null,
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null,
      time_preference: /^(pagi|siang|sore|malam)$/.test(timePreference) ? timePreference : null,
    };
  }

  return { VALID_BRANCHES, isValidIsoDate, parseBookingHandoff };
}));
