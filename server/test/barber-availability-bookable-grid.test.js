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
const { getOutletBookableGrid, isOnBookableGrid, filterToBookableGrid } = require('../services/bookableSlotGrid');

/**
 * P1 production fix regression: Reddy must only ever report a customer-
 * bookable (hourly) slot, never a raw 30-minute-granularity calendar
 * boundary that slotEngine.js's getAvailableSlots() generates internally.
 * Root cause: the website (public/js/booking.js) renders its own hardcoded
 * hourly grid and checks each hourly candidate against the raw availability
 * response; barberAvailabilityQuery.js was returning the raw response
 * directly with no such filtering. Reused mock pattern from
 * barber-availability-query.test.js.
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

const OUTLET = { id: 'outlet-csb', slug: 'csb', name: 'CSB' };
const UBAY = { id: 'barber-ubay', name: 'Ubay', outlet_id: OUTLET.id, is_active: true, home_service_enabled: false };

const TODAY = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
const DOW = new Date(`${TODAY}T12:00:00Z`).getUTCDay();

function baseTables({ workingHours = [], schedules = [], bookings = [] } = {}) {
  return {
    outlets: [OUTLET],
    barbers: [UBAY],
    barber_working_hours: workingHours,
    barber_date_overrides: [],
    schedules,
    bookings,
  };
}

const FULL_DAY_HOURS = [{ barber_id: UBAY.id, day_of_week: DOW, open_time: '10:00', close_time: '21:00', is_off: false }];

test('unit: bookableSlotGrid module — canonical grid is hourly 10:00-20:00, never :30', () => {
  const grid = getOutletBookableGrid();
  assert.deepEqual(grid, ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00']);
  assert.ok(grid.every((t) => t.endsWith(':00')));
  assert.equal(isOnBookableGrid('10:30'), false);
  assert.equal(isOnBookableGrid('10:00'), true);
});

test('unit: filterToBookableGrid keeps only grid-aligned free times, in grid order', () => {
  const filtered = filterToBookableGrid(['10:00', '10:30', '11:00', '11:30', '12:00', '19:00']);
  assert.deepEqual(filtered, ['10:00', '11:00', '12:00', '19:00']);
});

test('Case 1: production bug reproduction — 19:00 busy, reported alternatives must never include :30', async () => {
  const supabase = makeSupabase(baseTables({
    workingHours: FULL_DAY_HOURS,
    schedules: [{
      barber_id: UBAY.id, outlet_id: OUTLET.id,
      start_time: new Date(`${TODAY}T19:00:00+07:00`).toISOString(),
      end_time: new Date(`${TODAY}T20:00:00+07:00`).toISOString(),
      status: 'confirmed',
    }],
  }));
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'csb', barberId: UBAY.id, date: TODAY, time: '19:00', durationMinutes: 30 });
  assert.equal(result.available, false);
  assert.ok(!result.off_grid, '19:00 itself is a valid grid position, not off_grid');
  for (const alt of result.alternative_slots) {
    assert.ok(isOnBookableGrid(alt), `alternative "${alt}" must be a valid hourly grid position`);
    assert.ok(!alt.endsWith(':30'), `alternative "${alt}" must never be a half-hour boundary`);
  }
  assert.ok(result.alternative_slots.includes('18:00') || result.alternative_slots.includes('20:00'),
    'nearest real alternatives around 19:00 should be offered');
});

test('Case 2: direct half-hour request ("Ubay jam 10:30 bisa?") is never reported as bookable', async () => {
  const supabase = makeSupabase(baseTables({ workingHours: FULL_DAY_HOURS }));
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'csb', barberId: UBAY.id, date: TODAY, time: '10:30', durationMinutes: 30 });
  assert.equal(result.available, false);
  assert.equal(result.off_grid, true);
  assert.ok(result.alternative_slots.every((t) => isOnBookableGrid(t)));
  assert.ok(result.alternative_slots.includes('10:00') || result.alternative_slots.includes('11:00'));
});

test('Case 3: ordinary hourly request ("Ubay jam 11:00 bisa?") — normal live check, unaffected', async () => {
  const supabase = makeSupabase(baseTables({ workingHours: FULL_DAY_HOURS }));
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'csb', barberId: UBAY.id, date: TODAY, time: '11:00', durationMinutes: 30 });
  assert.equal(result.available, true);
  assert.ok(!result.off_grid);
});

test('Case 4: Moka overlap spanning a half-hour boundary never exposes the half-hour remainder, and the true hourly occupancy is respected', async () => {
  const supabase = makeSupabase(baseTables({
    workingHours: FULL_DAY_HOURS,
    schedules: [{
      barber_id: UBAY.id, outlet_id: OUTLET.id,
      start_time: new Date(`${TODAY}T10:30:00+07:00`).toISOString(),
      end_time: new Date(`${TODAY}T11:30:00+07:00`).toISOString(),
      status: 'confirmed', source: 'moka',
    }],
  }));
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'csb', barberId: UBAY.id, date: TODAY, durationMinutes: 30 });
  assert.ok(!result.available_slots.includes('11:30'), '11:30 must never appear — not a valid grid position');
  assert.ok(!result.available_slots.includes('11:00'), '11:00 hourly slot overlaps the Moka busy block and must be excluded');
  assert.ok(result.available_slots.every((t) => isOnBookableGrid(t)));
});

test('Case 5: parity — every slot barberAvailabilityQuery.js returns is a subset of the canonical bookable grid', async () => {
  const supabase = makeSupabase(baseTables({ workingHours: FULL_DAY_HOURS }));
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'csb', barberId: UBAY.id, date: TODAY, durationMinutes: 30 });
  const grid = new Set(getOutletBookableGrid());
  for (const slot of result.available_slots) {
    assert.ok(grid.has(slot), `"${slot}" is not on the canonical bookable grid — website/Reddy parity violated`);
  }
});

test('live production scenario reproduction: CSB/Ubay/today/19:00 — no :30 slot in any field of the result', async () => {
  const supabase = makeSupabase(baseTables({
    workingHours: FULL_DAY_HOURS,
    schedules: [{
      barber_id: UBAY.id, outlet_id: OUTLET.id,
      start_time: new Date(`${TODAY}T19:00:00+07:00`).toISOString(),
      end_time: new Date(`${TODAY}T19:30:00+07:00`).toISOString(),
      status: 'confirmed',
    }],
  }));
  const result = await checkBarberAvailability(supabase, { ...SERVICE, branch: 'csb', barberId: UBAY.id, date: TODAY, time: '19:00', durationMinutes: 30 });
  const serialized = JSON.stringify(result);
  assert.ok(!/:\d\d?:30"/.test(serialized) && !serialized.includes(':30"'), `result must contain no half-hour time anywhere: ${serialized}`);
});

