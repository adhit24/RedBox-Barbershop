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
 *
 * Provenance note (Task 14.1 round 3 audit): getBarberDateAvailability
 * internally checks barber_date_overrides before falling back to
 * barber_working_hours (and further to barbers.work_days), but its return
 * value does not expose WHICH of the three actually decided the result.
 * `source` below is deliberately the generic "planned_schedule_lookup"
 * rather than naming a specific table — claiming e.g. 'barber_working_hours'
 * unconditionally would be materially false whenever an override was the
 * one that actually applied. Do not narrow this without first getting
 * getBarberDateAvailability to report which branch it took.
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
      source: 'planned_schedule_lookup',
      date,
    };
  } catch (_error) {
    return { status: 'unknown', source: null, date };
  }
}

module.exports = { getBarberScheduleStatus };
