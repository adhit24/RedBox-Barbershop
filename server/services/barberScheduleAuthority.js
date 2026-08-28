'use strict';

const { getBarberDateAvailability } = require('../moka/slotEngine');

/**
 * Task 14.1 correction round 2 (Blocker 3) — read-only wrapper around the
 * website booking engine's OWN barber-availability lookup
 * (server/moka/slotEngine.js getBarberDateAvailability, already used in
 * production to gate booking creation in server/moka/routes.js). Reused
 * as-is rather than re-implemented — it already correctly combines the
 * recurring weekly barber_working_hours with barber_date_overrides
 * (date-specific exceptions/days off), which take priority.
 *
 * This is PLANNED SCHEDULE authority only — "is this barber expected to work
 * this date" — never attendance/check-in ("is this barber physically present
 * right now"). No attendance/check-in source exists anywhere in this
 * codebase; do not upgrade this status to a presence claim.
 */
async function getBarberScheduleStatus(supabase, { barberId, date } = {}) {
  if (!supabase || !barberId || !date) {
    return { status: 'unknown', source: null, date: date || null };
  }
  try {
    const availability = await getBarberDateAvailability(supabase, { barberId, date });
    if (!availability?.exists || availability.isActive === false) {
      return { status: 'unknown', source: null, date };
    }
    return {
      status: availability.isWorking ? 'scheduled' : 'not_scheduled',
      source: 'barber_working_hours',
      date,
    };
  } catch (_error) {
    return { status: 'unknown', source: null, date };
  }
}

module.exports = { getBarberScheduleStatus };
