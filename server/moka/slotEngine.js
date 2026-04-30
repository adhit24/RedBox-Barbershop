'use strict';
// ============================================================
// MOKA POS  —  Slot Availability Engine
//
// Generates bookable time slots for a given date + outlet.
// Takes into account:
//   • Barber working hours (barber_working_hours table)
//   • Existing non-cancelled schedules
//   • Requested service duration
// ============================================================

const SLOT_INTERVAL_MIN = 30; // generate a candidate slot every 30 minutes

/**
 * Return all available booking slots for a given outlet + date + duration.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} params
 * @param {string}  params.outletId         - UUID
 * @param {string}  params.date             - 'YYYY-MM-DD'
 * @param {number}  params.durationMinutes  - how long the service takes
 * @param {string}  [params.barberId]       - narrow to one barber (optional)
 * @param {string}  [params.timezone='Asia/Jakarta']
 *
 * @returns {Promise<Array<{ start:string, end:string, barberId:string, barberName:string }>>}
 */
async function getAvailableSlots(supabase, {
  outletId,
  date,
  durationMinutes,
  barberId = null,
  timezone = 'Asia/Jakarta',
}) {
  // ── 1. Load barbers for this outlet ───────────────────────
  const barbersQuery = supabase
    .from('barbers')
    .select('id, name, is_active')
    .eq('outlet_id', outletId)
    .eq('is_active', true);

  if (barberId) barbersQuery.eq('id', barberId);

  const { data: barbers, error: barbersErr } = await barbersQuery;
  if (barbersErr) throw new Error(`Barbers fetch failed: ${barbersErr.message}`);
  if (!barbers?.length) return [];

  // ── 2. Load working hours for this day-of-week ─────────────
  const dayOfWeek = _dayOfWeek(date);  // 0=Sun … 6=Sat

  const { data: hours } = await supabase
    .from('barber_working_hours')
    .select('barber_id, open_time, close_time, is_off')
    .in('barber_id', barbers.map(b => b.id))
    .eq('day_of_week', dayOfWeek);

  const workingHoursMap = _indexBy(hours || [], 'barber_id');

  // ── 3. Load existing schedules for the day ─────────────────
  const dayStart = `${date}T00:00:00+07:00`;
  const dayEnd   = `${date}T23:59:59+07:00`;

  const { data: existing } = await supabase
    .from('schedules')
    .select('barber_id, start_time, end_time')
    .eq('outlet_id', outletId)
    .not('status', 'in', '("cancelled")')
    .gte('start_time', dayStart)
    .lte('end_time',   dayEnd);

  // Group busy slots by barber
  const busyMap = {};
  for (const s of existing || []) {
    if (!busyMap[s.barber_id]) busyMap[s.barber_id] = [];
    busyMap[s.barber_id].push({
      start: new Date(s.start_time).getTime(),
      end:   new Date(s.end_time).getTime(),
    });
  }

  // ── 4. Generate slots ──────────────────────────────────────
  const slots = [];
  const now   = Date.now();

  for (const barber of barbers) {
    const wh = workingHoursMap[barber.id];

    // Use working hours from DB, or fall back to outlet defaults (09:00–21:00)
    const openTime  = (wh && !wh.is_off) ? wh.open_time  : '09:00';
    const closeTime = (wh && !wh.is_off) ? wh.close_time : '21:00';

    // If barber is off this day, skip
    if (wh?.is_off) continue;

    // Alternatively: check barber's work_days array (existing schema field)
    // wh table takes precedence; fall back to barber.work_days if no wh row
    if (!wh) {
      const { data: b } = await supabase
        .from('barbers').select('work_days').eq('id', barber.id).single();
      const shortDay = _shortDayName(dayOfWeek);
      if (b?.work_days && !b.work_days.includes(shortDay)) continue;
    }

    const openMs  = _timeStrToMs(date, openTime);
    const closeMs = _timeStrToMs(date, closeTime);
    const busy    = busyMap[barber.id] || [];

    // Slide candidate windows across the barber's working day
    let cursor = openMs;
    while (cursor + durationMinutes * 60_000 <= closeMs) {
      const slotStart = cursor;
      const slotEnd   = cursor + durationMinutes * 60_000;

      // Skip slots already in the past (with 15 min buffer)
      if (slotStart < now + 15 * 60_000) {
        cursor += SLOT_INTERVAL_MIN * 60_000;
        continue;
      }

      // Check overlap against all existing schedules for this barber
      const isBusy = busy.some(b => slotStart < b.end && slotEnd > b.start);

      if (!isBusy) {
        slots.push({
          start:      new Date(slotStart).toISOString(),
          end:        new Date(slotEnd).toISOString(),
          barberId:   barber.id,
          barberName: barber.name,
        });
      }

      cursor += SLOT_INTERVAL_MIN * 60_000;
    }
  }

  // Sort by start time, then by barber name for determinism
  slots.sort((a, b) => {
    const dt = new Date(a.start) - new Date(b.start);
    return dt !== 0 ? dt : a.barberName.localeCompare(b.barberName);
  });

  return slots;
}

/**
 * Check whether a specific barber + time window is available.
 * Lightweight version used by POST /api/reservations before inserting.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ barberId:string, startTime:string, endTime:string, excludeScheduleId?:string }} params
 * @returns {Promise<boolean>} true = slot is FREE
 */
async function isSlotAvailable(supabase, { barberId, startTime, endTime, excludeScheduleId }) {
  const { data: conflict } = await supabase.rpc('check_barber_overlap', {
    p_barber_id:  barberId,
    p_start:      startTime,
    p_end:        endTime,
    p_exclude_id: excludeScheduleId || null,
  });
  return conflict === false; // RPC returns TRUE when there IS an overlap
}

// ── PRIVATE ───────────────────────────────────────────────

/** 'YYYY-MM-DD' → 0..6 (0=Sunday) */
function _dayOfWeek(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

const SHORT_DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function _shortDayName(dow) { return SHORT_DAYS[dow]; }

/** Convert 'HH:MM' on a given date to epoch ms (WIB = UTC+7) */
function _timeStrToMs(dateStr, timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  // Build as WIB by appending +07:00
  return new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+07:00`).getTime();
}

function _indexBy(arr, key) {
  const map = {};
  for (const item of arr) map[item[key]] = item;
  return map;
}

module.exports = { getAvailableSlots, isSlotAvailable };
