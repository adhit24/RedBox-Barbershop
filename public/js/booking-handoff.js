(function bookingHandoffModule(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RedboxBookingHandoff = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function bookingHandoffFactory() {
  'use strict';

  const VALID_BRANCHES = new Set(['bypass', 'samadikun', 'csb', 'sumber', 'tegal']);

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
