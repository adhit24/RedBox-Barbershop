'use strict';

/**
 * Canonical customer-bookable slot grid (P1 fix: Reddy must only ever report
 * a slot a customer can actually select on the booking website).
 *
 * Root cause of the bug this fixes: slotEngine.js's getAvailableSlots()
 * generates 30-minute-granularity CANDIDATE times (SLOT_INTERVAL_MIN = 30)
 * as an internal free/busy computation aid — it was never meant to be the
 * customer-facing slot list. The website (public/js/booking.js,
 * buildTimeGrid()) never renders those raw 30-minute boundaries; it renders
 * its own hardcoded hourly grid (`slotsDefault`/`slotsCsb` = 10:00..20:00,
 * `slotsHomeService` = 06:00..23:00) and marks each hourly candidate bookable
 * only when that exact HH:00 string is present in the raw availability
 * response (`isBooked = !mokaFreeSet.has(slot)`, booking.js line ~1849).
 * barberAvailabilityQuery.js was returning the raw 30-minute list directly,
 * which is why ":30" times leaked into Reddy's replies.
 *
 * This module is the server-side half of that same rule. A true single
 * shared module across the static client JS and the Node server isn't
 * feasible without a build step (out of scope for this fix) — so this stays
 * the canonical SERVER-SIDE definition, and MUST be kept in sync with
 * public/js/booking.js's slotsDefault/slotsCsb/slotsHomeService arrays if
 * either ever changes. Do not fork a second, differently-derived rule
 * anywhere else server-side.
 */

const OUTLET_GRID = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];

/** Returns the canonical bookable-slot grid for the outlet booking flow (the only flow barberAvailabilityQuery.js supports). */
function getOutletBookableGrid() {
  return OUTLET_GRID.slice();
}

/** True if `time` ('HH:mm') is a valid bookable grid position. */
function isOnBookableGrid(time) {
  return OUTLET_GRID.includes(time);
}

/**
 * Given the raw, 30-minute-granularity free times slotEngine.js produced
 * (as 'HH:mm' strings), return only the ones that are ALSO on the canonical
 * bookable grid — i.e. what a customer could actually select on the website.
 */
function filterToBookableGrid(rawFreeTimes) {
  const freeSet = new Set(rawFreeTimes);
  return OUTLET_GRID.filter((slot) => freeSet.has(slot));
}

module.exports = { getOutletBookableGrid, isOnBookableGrid, filterToBookableGrid };
