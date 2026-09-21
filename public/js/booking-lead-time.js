(function exposeBookingLeadTime(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RedboxBookingLeadTime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBookingLeadTime() {
  'use strict';

  const TIMEZONE = 'Asia/Jakarta';
  const MIN_LEAD_TIME_MINUTES = 60;
  const CSB_LAST_SLOT = '21:00';
  const DEFAULT_LAST_SLOT = '20:00';
  const HOME_SERVICE_LAST_SLOT = '23:00';

  /**
   * Convert any date / timestamp to WIB (Asia/Jakarta) wall-clock components.
   * Works reliably regardless of the server's or browser's host timezone (e.g. UTC on Vercel).
   *
   * @param {Date|number|string} [refDate=new Date()]
   * @returns {{ dateStr: string, timeStr: string, hour: number, minute: number, totalMinutes: number, isoString: string }}
   */
  function getWibDateTime(refDate = new Date()) {
    const d = refDate instanceof Date ? refDate : new Date(refDate);
    if (isNaN(d.getTime())) {
      throw new Error('Invalid date passed to getWibDateTime');
    }

    // Format YYYY-MM-DD in Asia/Jakarta
    const dateParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);

    const year = dateParts.find(p => p.type === 'year').value;
    const month = dateParts.find(p => p.type === 'month').value;
    const day = dateParts.find(p => p.type === 'day').value;
    const dateStr = `${year}-${month}-${day}`;

    // Format HH:mm in Asia/Jakarta (24h)
    const timeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);

    const hour = parseInt(timeParts.find(p => p.type === 'hour').value, 10);
    const minute = parseInt(timeParts.find(p => p.type === 'minute').value, 10);
    const second = parseInt(timeParts.find(p => p.type === 'second').value, 10);

    const pad = n => String(n).padStart(2, '0');
    const timeStr = `${pad(hour)}:${pad(minute)}`;
    const totalMinutes = hour * 60 + minute;
    const isoString = `${dateStr}T${pad(hour)}:${pad(minute)}:${pad(second)}+07:00`;

    return {
      dateStr,
      timeStr,
      hour,
      minute,
      second,
      totalMinutes,
      isoString,
    };
  }

  /**
   * Determine whether a booking context represents a home service appointment.
   *
   * @param {object|string} [context]
   * @returns {boolean}
   */
  function isHomeServiceBooking(context) {
    if (!context) return false;
    if (typeof context === 'string') {
      const s = context.trim().toLowerCase();
      return s === 'home_service' || s === 'homeservice' || s === 'home-service';
    }
    if (context.isHomeService === true) return true;
    const typeStr = String(context.bookingType || context.type || '').trim().toLowerCase();
    return typeStr === 'home_service' || typeStr === 'homeservice' || typeStr === 'home-service';
  }

  /**
   * Return the last allowed booking slot based on booking context and branch.
   * - Home Service: 23:00 WIB across all branches
   * - Outlet CSB: 21:00 WIB
   * - Outlet (other branches): 20:00 WIB
   *
   * Accepts either an options object or a legacy branchSlug string.
   *
   * @param {object|string} [options]
   * @param {string} [options.branch]
   * @param {string} [options.bookingType]
   * @param {boolean} [options.isHomeService]
   * @param {string} [options.lastAllowedSlot]
   * @returns {string} 'HH:mm'
   */
  function getLastAllowedSlot(options) {
    if (typeof options === 'string') {
      const normalized = options.trim().toLowerCase();
      if (normalized === 'home_service' || normalized === 'homeservice' || normalized === 'home-service') {
        return HOME_SERVICE_LAST_SLOT;
      }
      if (normalized === 'csb' || normalized.includes('csb')) {
        return CSB_LAST_SLOT;
      }
      return DEFAULT_LAST_SLOT;
    }

    const opts = options || {};
    if (opts.lastAllowedSlot && typeof opts.lastAllowedSlot === 'string') {
      return opts.lastAllowedSlot.slice(0, 5);
    }

    if (isHomeServiceBooking(opts)) {
      return HOME_SERVICE_LAST_SLOT;
    }

    const branch = String(opts.branch || opts.location || '').trim().toLowerCase();
    if (branch === 'csb' || branch.includes('csb')) {
      return CSB_LAST_SLOT;
    }
    return DEFAULT_LAST_SLOT;
  }

  /**
   * Return the last allowed booking slot for a given branch slug (backwards compatible).
   *
   * @param {string} [branchSlug]
   * @returns {string} 'HH:mm'
   */
  function getBranchLastSlot(branchSlug) {
    return getLastAllowedSlot(branchSlug);
  }

  /**
   * Convert 'HH:mm' time string to total minutes since midnight.
   *
   * @param {string} timeStr e.g. '16:18'
   * @returns {number}
   */
  function timeStrToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const [h, m] = timeStr.split(':').map(n => parseInt(n, 10));
    return (h || 0) * 60 + (m || 0);
  }

  /**
   * Format total minutes to 'HH:mm'.
   *
   * @param {number} totalMinutes
   * @returns {string}
   */
  function minutesToTimeStr(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /**
   * Calculate earliest allowed slot for today in Asia/Jakarta based on the formula:
   * waktu minimum = waktu WIB sekarang + 60 menit
   * slot paling awal = pembulatan ke atas ke slot per jam berikutnya
   *
   * Examples:
   * 16:00 -> 17:00 (target: 17:00 -> round up to next hour = 17:00)
   * 16:01 -> 18:00 (target: 17:01 -> round up to next hour = 18:00)
   * 16:18 -> 18:00 (target: 17:18 -> round up to next hour = 18:00)
   * 16:59 -> 18:00 (target: 17:59 -> round up to next hour = 18:00)
   * 17:00 -> 18:00 (target: 18:00 -> round up to next hour = 18:00)
   *
   * @param {Date|number|string} [refDate=new Date()]
   * @returns {string} e.g. '18:00'
   */
  function calculateEarliestAllowedSlot(refDate = new Date()) {
    const wib = getWibDateTime(refDate);
    const targetMinutes = wib.totalMinutes + MIN_LEAD_TIME_MINUTES;
    const earliestHour = Math.ceil(targetMinutes / 60);
    return `${String(earliestHour).padStart(2, '0')}:00`;
  }

  /**
   * Determine whether a booking is permitted according to:
   * 1. 60-minute minimum lead time for same-day booking (rounded up to next hour).
   * 2. Operating hours cutoff (23:00 for Home Service, 21:00 for CSB, 20:00 for other branches).
   *
   * @param {object} params
   * @param {string} params.bookingDate - 'YYYY-MM-DD'
   * @param {string} params.bookingTime - 'HH:mm'
   * @param {string} [params.branch] - branch slug / identifier
   * @param {string} [params.bookingType] - 'outlet', 'home_service', etc.
   * @param {boolean} [params.isHomeService]
   * @param {string} [params.lastAllowedSlot] - optional explicit cutoff override
   * @param {Date|number|string} [params.refDate=new Date()] - reference time (defaults to now)
   * @param {boolean} [params.isAdmin=false] - true for admin backoffice bypass
   * @returns {{ allowed: boolean, error?: string, message?: string, earliestAllowedSlot?: string, timezone: string }}
   */
  function isBookingLeadTimeAllowed({
    bookingDate,
    bookingTime,
    branch = 'bypass',
    bookingType,
    type,
    isHomeService,
    lastAllowedSlot,
    refDate = new Date(),
    isAdmin = false,
  }) {
    if (isAdmin) {
      return { allowed: true, timezone: TIMEZONE };
    }

    if (!bookingDate || !bookingTime) {
      return {
        allowed: false,
        error: 'BOOKING_INVALID_DATETIME',
        message: 'Tanggal dan jam booking wajib diisi.',
        timezone: TIMEZONE,
      };
    }

    const cleanDate = String(bookingDate).slice(0, 10);
    const cleanTime = String(bookingTime).slice(0, 5);
    const wib = getWibDateTime(refDate);

    // If booking is for a past date, reject
    if (cleanDate < wib.dateStr) {
      return {
        allowed: false,
        error: 'BOOKING_DATE_IN_PAST',
        message: 'Tanggal booking tidak boleh di masa lalu.',
        timezone: TIMEZONE,
      };
    }

    const effectiveLastSlot = getLastAllowedSlot({
      branch,
      bookingType: bookingType || type,
      isHomeService,
      lastAllowedSlot,
    });
    const bookingMinutes = timeStrToMinutes(cleanTime);
    const lastSlotMinutes = timeStrToMinutes(effectiveLastSlot);

    // If booking is for future date (tomorrow or later), 60-min lead time does not apply!
    // Operating hours cutoff still applies.
    if (cleanDate > wib.dateStr) {
      if (bookingMinutes > lastSlotMinutes) {
        return {
          allowed: false,
          error: 'BOOKING_AFTER_CLOSING',
          message: `Slot booking melebihi slot terakhir (${effectiveLastSlot} WIB).`,
          timezone: TIMEZONE,
        };
      }
      return { allowed: true, timezone: TIMEZONE };
    }

    // Same-day booking: enforce 60-minute lead time rounded up to next hour
    const earliestAllowedSlot = calculateEarliestAllowedSlot(refDate);
    const earliestMinutes = timeStrToMinutes(earliestAllowedSlot);

    if (bookingMinutes < earliestMinutes) {
      return {
        allowed: false,
        error: 'BOOKING_LEAD_TIME_VIOLATION',
        message: 'Booking harus dilakukan minimal 1 jam sebelumnya.',
        earliestAllowedSlot,
        timezone: TIMEZONE,
      };
    }

    // Operating hours check
    if (bookingMinutes > lastSlotMinutes) {
      return {
        allowed: false,
        error: 'BOOKING_AFTER_CLOSING',
        message: `Slot booking melebihi slot terakhir (${effectiveLastSlot} WIB).`,
        earliestAllowedSlot,
        timezone: TIMEZONE,
      };
    }

    return {
      allowed: true,
      earliestAllowedSlot,
      timezone: TIMEZONE,
    };
  }

  /**
   * Filter candidate slots list for same-day booking.
   *
   * @param {object} params
   * @param {string[]} params.slots - candidate slots e.g. ['10:00', '11:00', ...]
   * @param {string} params.bookingDate - 'YYYY-MM-DD'
   * @param {string} [params.branch] - branch slug
   * @param {string} [params.bookingType]
   * @param {boolean} [params.isHomeService]
   * @param {string} [params.lastAllowedSlot]
   * @param {Date|number|string} [params.refDate=new Date()]
   * @returns {{ filteredSlots: string[], earliestAllowedSlot: string|null, isClosedToday: boolean }}
   */
  function filterSlotsForLeadTime({
    slots = [],
    bookingDate,
    branch = 'bypass',
    bookingType,
    type,
    isHomeService,
    lastAllowedSlot,
    refDate = new Date(),
  }) {
    const cleanDate = String(bookingDate || '').slice(0, 10);
    const wib = getWibDateTime(refDate);

    // If future date, no lead-time filtering is applied
    if (cleanDate !== wib.dateStr) {
      return {
        filteredSlots: slots.slice(),
        earliestAllowedSlot: null,
        isClosedToday: false,
      };
    }

    const earliestAllowedSlot = calculateEarliestAllowedSlot(refDate);
    const earliestMinutes = timeStrToMinutes(earliestAllowedSlot);
    const effectiveLastSlot = getLastAllowedSlot({
      branch,
      bookingType: bookingType || type,
      isHomeService,
      lastAllowedSlot,
    });
    const lastSlotMinutes = timeStrToMinutes(effectiveLastSlot);

    // Check if earliest slot already exceeds last slot
    const isClosedToday = earliestMinutes > lastSlotMinutes;

    const filteredSlots = isClosedToday
      ? []
      : slots.filter(s => timeStrToMinutes(s) >= earliestMinutes && timeStrToMinutes(s) <= lastSlotMinutes);

    return {
      filteredSlots,
      earliestAllowedSlot,
      isClosedToday: isClosedToday || filteredSlots.length === 0,
    };
  }

  return {
    TIMEZONE,
    MIN_LEAD_TIME_MINUTES,
    CSB_LAST_SLOT,
    DEFAULT_LAST_SLOT,
    HOME_SERVICE_LAST_SLOT,
    getWibDateTime,
    getBranchLastSlot,
    getLastAllowedSlot,
    isHomeServiceBooking,
    timeStrToMinutes,
    minutesToTimeStr,
    calculateEarliestAllowedSlot,
    isBookingLeadTimeAllowed,
    filterSlotsForLeadTime,
  };
});
