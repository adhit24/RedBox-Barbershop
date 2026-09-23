'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
// Pin the clock before opening: assertions about morning slots must not
// depend on the machine's current hour or the online lead-time filter.
test.mock.method(Date, 'now', () => Date.parse('2026-09-23T01:00:00Z'));
test.after(() => test.mock.restoreAll());

const { checkBarberAvailability } = require('../services/barberAvailabilityQuery');
// Explicit selected service fixture; availability no longer guesses a duration.
const SERVICE = { serviceId: 'traditional-shaving', durationMinutes: 30 };

/**
 * Minimal fake Supabase query builder — just enough chaining
 * (select/eq/in/not/lt/gt/single/maybeSingle, thenable resolution) to drive
 * the REAL server/moka/slotEngine.js logic against fixture data. This tests
 * the wrapper's shaping/error handling; the slot math itself is exercised
 * exactly as production runs it, never re-implemented here.
 */
function makeSupabase(tables) {
  function builder(tableName) {
    let rows = (tables[tableName] || []).slice();
    const filters = [];

    function apply() {
      let result = rows;
      for (const f of filters) {
        if (f.op === 'eq') result = result.filter((r) => r[f.col] === f.val);
        else if (f.op === 'in') result = result.filter((r) => f.val.includes(r[f.col]));
        else if (f.op === 'not_in') result = result.filter((r) => !f.val.includes(r[f.col]));
        else if (f.op === 'lt') result = result.filter((r) => new Date(r[f.col]).getTime() < new Date(f.val).getTime());
        else if (f.op === 'gt') result = result.filter((r) => new Date(r[f.col]).getTime() > new Date(f.val).getTime());
      }
      return result;
    }

    const chain = {
      select() { return chain; },
      eq(col, val) { filters.push({ op: 'eq', col, val }); return chain; },
      in(col, val) { filters.push({ op: 'in', col, val }); return chain; },
      not(col, opText, val) {
        // slotEngine calls .not('status', 'in', '("cancelled")') — parse the paren list.
        const list = String(val).replace(/[()"']/g, '').split(',').filter(Boolean);
        filters.push({ op: 'not_in', col, val: list });
        return chain;
      },
      lt(col, val) { filters.push({ op: 'lt', col, val }); return chain; },
      gt(col, val) { filters.push({ op: 'gt', col, val }); return chain; },
      single() {
        const result = apply();
        return Promise.resolve(result.length === 1 ? { data: result[0], error: null } : { data: null, error: { message: 'not found' } });
      },
      maybeSingle() {
        const result = apply();
        return Promise.resolve({ data: result[0] || null, error: null });
      },
      then(resolve, reject) {
        return Promise.resolve({ data: apply(), error: null }).then(resolve, reject);
      },
    };
    return chain;
  }

  return { from: (t) => builder(t) };
}

const OUTLET = { id: 'outlet-bypass', slug: 'bypass', name: 'Bypass' };
const ABDUL = { id: 'barber-abdul', name: 'Abdul', outlet_id: OUTLET.id, is_active: true, home_service_enabled: false };
const SOFYAN = { id: 'barber-sofyan', name: 'Sofyan', outlet_id: OUTLET.id, is_active: true, home_service_enabled: false };

const TODAY = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10); // WIB "today"
const SATURDAY_DOW = new Date(`${TODAY}T12:00:00Z`).getUTCDay();

function baseTables({ workingHours = [], overrides = [], schedules = [], bookings = [] } = {}) {
  return {
    outlets: [OUTLET],
    barbers: [ABDUL, SOFYAN],
    barber_working_hours: workingHours,
    barber_date_overrides: overrides,
    schedules,
    bookings,
  };
}

test('barber + date: working with open slots returns available_slots list', async () => {
  const supabase = makeSupabase(baseTables({
    workingHours: [{ barber_id: ABDUL.id, day_of_week: SATURDAY_DOW, open_time: '10:00', close_time: '22:00', is_off: false }],
  }));
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'bypass', barberId: ABDUL.id, date: TODAY });
  assert.equal(result.success, true);
  assert.equal(result.working, true);
  assert.ok(Array.isArray(result.available_slots));
  assert.equal(result.barber.name, 'Abdul');
  assert.equal(result.branch.name, 'Bypass');
});

test('work_days fallback: no barber_working_hours row at all, work_days includes today -> working with slots (real production shape)', async () => {
  // Real production data check (staging verification) showed this is
  // actually the COMMON case in practice — many active barbers have zero
  // barber_working_hours rows and rely entirely on barbers.work_days.
  const days = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
  const todayName = days[SATURDAY_DOW];
  const tables = baseTables({ workingHours: [] });
  tables.barbers = [{ ...ABDUL, work_days: [todayName.charAt(0).toUpperCase() + todayName.slice(1)] }, SOFYAN];
  const supabase = makeSupabase(tables);
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'bypass', barberId: ABDUL.id, date: TODAY });
  assert.equal(result.success, true);
  assert.equal(result.working, true);
  assert.ok(result.available_slots.length > 0, 'should generate slots using the default 10:00-21:00 outlet fallback hours');
});

test('work_days fallback: no barber_working_hours row, work_days does NOT include today -> barber_off', async () => {
  const days = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
  const otherDay = days[(SATURDAY_DOW + 1) % 7];
  const tables = baseTables({ workingHours: [] });
  tables.barbers = [{ ...ABDUL, work_days: [otherDay.charAt(0).toUpperCase() + otherDay.slice(1)] }, SOFYAN];
  const supabase = makeSupabase(tables);
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'bypass', barberId: ABDUL.id, date: TODAY });
  assert.equal(result.success, true);
  assert.equal(result.working, false);
  assert.equal(result.reason_code, 'barber_off');
  assert.deepEqual(result.available_slots, []);
});

test('barber off today: reason_code barber_off, no slots', async () => {
  const supabase = makeSupabase(baseTables({
    workingHours: [{ barber_id: ABDUL.id, day_of_week: SATURDAY_DOW, open_time: '10:00', close_time: '22:00', is_off: true }],
  }));
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'bypass', barberId: ABDUL.id, date: TODAY });
  assert.equal(result.success, true);
  assert.equal(result.working, false);
  assert.deepEqual(result.available_slots, []);
  assert.equal(result.reason_code, 'barber_off');
});

test('barber fully booked: working true, reason_code no_slot (not a separate fully_booked code)', async () => {
  const supabase = makeSupabase(baseTables({
    workingHours: [{ barber_id: ABDUL.id, day_of_week: SATURDAY_DOW, open_time: '10:00', close_time: '10:30', is_off: false }],
    bookings: [{ barber_id: ABDUL.id, date: TODAY, time: '10:00', duration: '30', status: 'confirmed' }],
  }));
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'bypass', barberId: ABDUL.id, date: TODAY, durationMinutes: 30 });
  assert.equal(result.working, true);
  assert.deepEqual(result.available_slots, []);
  assert.equal(result.reason_code, 'no_slot');
});

test('cancelled booking does not block the slot', async () => {
  const supabase = makeSupabase(baseTables({
    workingHours: [{ barber_id: ABDUL.id, day_of_week: SATURDAY_DOW, open_time: '10:00', close_time: '10:30', is_off: false }],
    bookings: [{ barber_id: ABDUL.id, date: TODAY, time: '10:00', duration: '30', status: 'cancelled' }],
  }));
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'bypass', barberId: ABDUL.id, date: TODAY, durationMinutes: 30 });
  assert.equal(result.reason_code, 'available');
  assert.ok(result.available_slots.length >= 1);
});

test('Moka-synced schedule row blocks the slot', async () => {
  const startIso = new Date(`${TODAY}T10:00:00+07:00`).toISOString();
  const endIso = new Date(`${TODAY}T10:30:00+07:00`).toISOString();
  const supabase = makeSupabase(baseTables({
    workingHours: [{ barber_id: ABDUL.id, day_of_week: SATURDAY_DOW, open_time: '10:00', close_time: '10:30', is_off: false }],
    schedules: [{ barber_id: ABDUL.id, outlet_id: OUTLET.id, start_time: startIso, end_time: endIso, status: 'confirmed' }],
  }));
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'bypass', barberId: ABDUL.id, date: TODAY, durationMinutes: 30 });
  assert.equal(result.reason_code, 'no_slot');
});

test('specific-time check: available true when slot is free', async () => {
  const supabase = makeSupabase(baseTables({
    workingHours: [{ barber_id: ABDUL.id, day_of_week: SATURDAY_DOW, open_time: '10:00', close_time: '22:00', is_off: false }],
  }));
  const result = await checkBarberAvailability(supabase, { ...SERVICE,
    branch: 'bypass', barberId: ABDUL.id, date: TODAY, time: '17:00', durationMinutes: 30,
  });
  assert.equal(result.requested_time, '17:00');
  // '17:00' should be a generated candidate slot given 10:00-22:00 working hours
  assert.equal(result.available, true);
});

test('specific-time check: available false with alternative_slots when busy', async () => {
  const busyIso = new Date(`${TODAY}T17:00:00+07:00`).toISOString();
  const busyEndIso = new Date(`${TODAY}T17:30:00+07:00`).toISOString();
  const supabase = makeSupabase(baseTables({
    workingHours: [{ barber_id: ABDUL.id, day_of_week: SATURDAY_DOW, open_time: '10:00', close_time: '22:00', is_off: false }],
    schedules: [{ barber_id: ABDUL.id, outlet_id: OUTLET.id, start_time: busyIso, end_time: busyEndIso, status: 'confirmed' }],
  }));
  const result = await checkBarberAvailability(supabase, { ...SERVICE,
    branch: 'bypass', barberId: ABDUL.id, date: TODAY, time: '17:00', durationMinutes: 30,
  });
  assert.equal(result.available, false);
  assert.ok(Array.isArray(result.alternative_slots));
});

test('branch-wide: aggregates every active barber, excludes anyone with no free slot', async () => {
  const supabase = makeSupabase(baseTables({
    workingHours: [
      { barber_id: ABDUL.id, day_of_week: SATURDAY_DOW, open_time: '10:00', close_time: '22:00', is_off: false },
      { barber_id: SOFYAN.id, day_of_week: SATURDAY_DOW, open_time: '10:00', close_time: '22:00', is_off: true },
    ],
  }));
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'bypass', date: TODAY, durationMinutes: 30 });
  assert.equal(result.success, true);
  assert.ok(result.barbers.some((b) => b.name === 'Abdul'));
  assert.ok(!result.barbers.some((b) => b.name === 'Sofyan'));
});

test('branch-wide: one barber lookup failing does not fail the whole request (partial failure)', async () => {
  const workingHours = [{ barber_id: ABDUL.id, day_of_week: SATURDAY_DOW, open_time: '10:00', close_time: '22:00', is_off: false }];
  const supabase = makeSupabase(baseTables({ workingHours }));
  // Sabotage getBarberDateAvailability for Sofyan by removing his barbers row entirely
  // (barbers table lookup by id in getBarberDateAvailability -> exists:false -> skipped, not thrown).
  // To actually exercise the catch path, monkey-patch supabase.from to throw for one specific call.
  const originalFrom = supabase.from;
  let sofyanHit = false;
  supabase.from = (table) => {
    const chain = originalFrom(table);
    if (table === 'barbers') {
      const originalEq = chain.eq;
      chain.eq = (col, val) => {
        if (col === 'id' && val === SOFYAN.id) { sofyanHit = true; throw new Error('boom'); }
        return originalEq(col, val);
      };
    }
    return chain;
  };
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'bypass', date: TODAY, durationMinutes: 30 });
  assert.equal(sofyanHit, true);
  assert.equal(result.success, true);
  assert.equal(result.partial, true);
  assert.equal(result.failed_barber_count, 1);
  assert.ok(result.barbers.every((b) => b.name !== 'Sofyan'));
});

test('branch not found returns branch_not_found, never guessed', async () => {
  const supabase = makeSupabase(baseTables());
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'nonexistent-branch', date: TODAY });
  assert.equal(result.success, false);
  assert.equal(result.reason_code, 'branch_not_found');
});

test('backend error (thrown query) surfaces as tool_error, never a guessed answer', async () => {
  const supabase = { from: () => { throw new Error('db down'); } };
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'bypass', barberId: ABDUL.id, date: TODAY });
  assert.equal(result.success, false);
  assert.equal(result.reason_code, 'tool_error');
});

test('missing required params (no supabase/branch/date) never throws, returns invalid_date', async () => {
  const result = await checkBarberAvailability(null, {});
  assert.equal(result.success, false);
  assert.equal(result.reason_code, 'invalid_date');
});

