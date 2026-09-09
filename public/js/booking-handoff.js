(function bookingHandoffModule(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RedboxBookingHandoff = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function bookingHandoffFactory(root) {
  'use strict';

  const VALID_BRANCHES = new Set(['bypass', 'samadikun', 'csb', 'sumber', 'tegal']);

  // Booking policy 2026-09-09: booking publik tidak boleh terhambat CAPTCHA.
  // booking.js masih memiliki compatibility gate lama yang membaca token dan
  // memanggil Worker verifikasi. Sampai gate lama dibersihkan dari file besar
  // booking.js, shim ini membuat flow lama transparan bagi user:
  // 1) widget Turnstile disembunyikan,
  // 2) token kompatibilitas disediakan agar handler lama tidak berhenti,
  // 3) request ke Worker lama dijawab lokal sebagai sukses.
  // Server booking sendiri juga sudah tidak menjadikan Turnstile sebagai gate.
  const LEGACY_TURNSTILE_VERIFY_URL = 'https://turnstile-siteverify-redbox-booking.adhit24.workers.dev';
  const PUBLIC_BOOKING_COMPAT_TOKEN = 'redbox-public-booking-no-captcha';

  function ensureCaptchaFreeBookingUi() {
    if (!root || !root.document) return;

    const doc = root.document;
    doc.querySelectorAll('.cf-turnstile').forEach((el) => {
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
    });

    let tokenInput = doc.querySelector('[name="cf-turnstile-response"]');
    if (!tokenInput) {
      tokenInput = doc.createElement('input');
      tokenInput.type = 'hidden';
      tokenInput.name = 'cf-turnstile-response';
      doc.body.appendChild(tokenInput);
    }
    tokenInput.value = PUBLIC_BOOKING_COMPAT_TOKEN;
  }

  if (root && root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', ensureCaptchaFreeBookingUi, { once: true });
    } else {
      ensureCaptchaFreeBookingUi();
    }
  }

  if (root && typeof root.fetch === 'function' && !root.__rbCaptchaFreeBookingShim) {
    const nativeFetch = root.fetch.bind(root);
    root.fetch = function redboxCaptchaFreeBookingFetch(input, init) {
      const url = typeof input === 'string'
        ? input
        : (input && typeof input.url === 'string' ? input.url : '');

      if (url === LEGACY_TURNSTILE_VERIFY_URL) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          captcha_disabled: true,
          policy: 'public-booking-no-captcha',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }

      return nativeFetch(input, init);
    };
    root.__rbCaptchaFreeBookingShim = true;
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
