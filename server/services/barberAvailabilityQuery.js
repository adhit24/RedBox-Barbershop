'use strict';

const { getAvailableSlots, getBarberDateAvailability } = require('../moka/slotEngine');

/**
 * Read-only adapter over the existing website booking engine's slot math
 * (server/moka/slotEngine.js) for Reddy's WhatsApp availability capability.
 * Reused as-is rather than re-implemented, following the same pattern as
 * server/services/barberScheduleAuthority.js: this file must never contain
 * working-hours, busy-slot/overlap, date-override, Moka busy-block, or
 * cancelled/expired filtering logic — all of that stays inside slotEngine.js.
 *
 * Never returns customer identity, phone, booking notes, booking IDs, or
 * payment info — only barber/branch/date/time/availability fields.
 */

const DEFAULT_DURATION_MINUTES = 30; // base outlet slot granularity; used when no service is specified
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accept UUID or slug, return outlet UUID (or null if not found). Mirrors moka/routes.js's private _resolveOutletId. */
async function resolveOutletId(supabase, rawBranch) {
  if (!rawBranch) return null;
  if (UUID_RE.test(rawBranch)) return rawBranch;
  const { data } = await supabase.from('outlets').select('id, name').eq('slug', rawBranch).maybeSingle();
  return data || null;
}

function toHHMM(isoString) {
  // slotEngine timestamps are ISO in UTC but represent WIB wall-clock times computed via +07:00 offsets;
  // format directly against Asia/Jakarta to get the correct local hour regardless of runtime TZ.
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(isoString));
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * checkBarberAvailability — single entry point for the availability capability.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.branch            - outlet slug or UUID
 * @param {string} [params.barberId]        - specific barber (by canonical id); omit for branch-wide mode
 * @param {string} params.date              - 'YYYY-MM-DD'
 * @param {string} [params.time]            - 'HH:mm', for a specific-time check
 * @param {{start:string,end:string}} [params.timeRange] - 'HH:mm' bounds, used as a search filter only
 * @param {number} [params.durationMinutes] - service duration; defaults to base outlet granularity
 * @returns {Promise<object>} structured, PII-safe result (see spec §11)
 */
async function checkBarberAvailability(supabase, {
  branch, barberId = null, date, time = null, timeRange = null, durationMinutes = null,
} = {}) {
  if (!supabase || !branch || !date) {
    return { success: false, reason_code: 'invalid_date' };
  }

  let outlet;
  try {
    outlet = await resolveOutletId(supabase, branch);
  } catch (_error) {
    return { success: false, reason_code: 'tool_error' };
  }
  if (!outlet?.id) {
    return { success: false, reason_code: 'branch_not_found' };
  }

  const duration = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : DEFAULT_DURATION_MINUTES;

  if (barberId) {
    return checkSingleBarber(supabase, {
      outlet, barberId, date, time, timeRange, durationMinutes: duration,
    });
  }

  return checkBranchWide(supabase, {
    outlet, date, time, timeRange, durationMinutes: duration,
  });
}

async function checkSingleBarber(supabase, {
  outlet, barberId, date, time, timeRange, durationMinutes,
}) {
  let dateAvailability;
  try {
    dateAvailability = await getBarberDateAvailability(supabase, { barberId, date });
  } catch (_error) {
    return { success: false, reason_code: 'tool_error' };
  }

  if (!dateAvailability.exists || dateAvailability.isActive === false) {
    return { success: false, reason_code: 'barber_not_found' };
  }

  let barberName = null;
  try {
    const { data } = await supabase.from('barbers').select('name').eq('id', barberId).maybeSingle();
    barberName = data?.name || null;
  } catch (_error) {
    barberName = null;
  }

  const base = {
    success: true,
    source: 'slot_engine',
    checked_at: nowIso(),
    branch: { id: outlet.id, name: outlet.name || null },
    barber: { id: barberId, name: barberName },
    date,
  };

  if (!dateAvailability.isWorking) {
    return { ...base, working: false, working_hours: null, available_slots: [], reason_code: 'barber_off' };
  }

  let slots;
  try {
    slots = await getAvailableSlots(supabase, {
      outletId: outlet.id, date, durationMinutes, barberId, type: 'outlet',
    });
  } catch (_error) {
    return { success: false, reason_code: 'tool_error' };
  }

  let times = slots.map((slot) => toHHMM(slot.start));
  times = filterByTimeRange(times, timeRange);

  const result = {
    ...base,
    working: true,
    working_hours: null,
    available_slots: times,
    reason_code: times.length ? 'available' : 'no_slot',
  };

  if (time) {
    const available = times.includes(time);
    return {
      ...result,
      requested_time: time,
      available,
      alternative_slots: available ? [] : times.slice(0, 3),
    };
  }

  return result;
}

async function checkBranchWide(supabase, {
  outlet, date, time, timeRange, durationMinutes,
}) {
  const { data: barbers, error: barbersErr } = await supabase
    .from('barbers')
    .select('id, name')
    .eq('outlet_id', outlet.id)
    .eq('is_active', true);

  if (barbersErr) return { success: false, reason_code: 'tool_error' };
  if (!barbers?.length) return { success: false, reason_code: 'branch_not_found' };

  const results = [];
  let failedCount = 0;

  for (const barber of barbers) {
    try {
      const dateAvailability = await getBarberDateAvailability(supabase, { barberId: barber.id, date });
      if (!dateAvailability.exists || dateAvailability.isActive === false || !dateAvailability.isWorking) continue;

      const slots = await getAvailableSlots(supabase, {
        outletId: outlet.id, date, durationMinutes, barberId: barber.id, type: 'outlet',
      });
      let times = slots.map((slot) => toHHMM(slot.start));
      times = filterByTimeRange(times, timeRange);
      if (time) times = times.includes(time) ? [time] : [];
      if (times.length) {
        results.push({ id: barber.id, name: barber.name, available_slots: times });
      }
    } catch (_error) {
      failedCount += 1;
    }
  }

  if (failedCount === barbers.length) {
    return { success: false, reason_code: 'tool_error' };
  }

  return {
    success: true,
    source: 'slot_engine',
    checked_at: nowIso(),
    branch: { id: outlet.id, name: outlet.name || null },
    date,
    requested_time: time || null,
    barbers: results,
    reason_code: results.length ? 'available' : 'no_slot',
    ...(failedCount > 0 ? { partial: true, failed_barber_count: failedCount } : {}),
  };
}

function filterByTimeRange(times, timeRange) {
  if (!timeRange?.start || !timeRange?.end) return times;
  return times.filter((t) => t >= timeRange.start && t < timeRange.end);
}

module.exports = { checkBarberAvailability };
