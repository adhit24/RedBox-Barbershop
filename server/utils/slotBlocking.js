'use strict';
// Single source of truth: which schedule/booking statuses hold a barber's slot.
//
// Lifecycle in this codebase:
//   schedules.status  : reserved | confirmed | in_progress | completed | cancelled  (Moka + web)
//   bookings.status   : pending | confirmed | done | cancelled  (+ rejected on deny)
//
// Terminal "released" statuses never block. Everything else (including
// completed/done, and any unknown value) keeps blocking - fail-safe against
// double booking.

const NON_BLOCKING_STATUSES = Object.freeze([
  'cancelled',
  'canceled',
  'rejected',
  'void',
  'voided',
  'expired',
  'no_show',
  'no-show',
]);

const _NON_BLOCKING = new Set(NON_BLOCKING_STATUSES);

function normalizeStatus(status) {
  return String(status == null ? '' : status).trim().toLowerCase();
}

/** true when a row with this status occupies the barber's slot. */
function isBlockingStatus(status) {
  return !_NON_BLOCKING.has(normalizeStatus(status));
}

/** Keep only rows whose `status` still blocks a slot. */
function filterBlocking(rows) {
  return (rows || []).filter((row) => isBlockingStatus(row && row.status));
}

module.exports = { NON_BLOCKING_STATUSES, normalizeStatus, isBlockingStatus, filterBlocking };
