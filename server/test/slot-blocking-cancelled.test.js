'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { isBlockingStatus, filterBlocking } = require('../utils/slotBlocking');
const { getAvailableSlots } = require('../moka/slotEngine');
const createMokaRouter = require('../moka/routes');

const BARBER = 'csb-ragil';
const DATE = '2026-09-24';
const REF = '2026-09-24T09:00:00+07:00'; // "now" well before 17:00 WIB

// Minimal chainable PostgREST fake. Filters are recorded but only the ones we
// need are applied; status filtering is deliberately NOT emulated so the code
// under test must do it itself (as production data can contain any casing).
function fakeSupabase({ schedules = [], bookings = [] } = {}) {
  const tables = {
    barbers: [{ id: BARBER, name: 'Ragil', is_active: true, home_service_enabled: false }],
    barber_working_hours: [{ barber_id: BARBER, open_time: '10:00', close_time: '21:00', is_off: false }],
    barber_date_overrides: [],
    schedules,
    schedules_full: schedules,
    bookings,
  };
  return {
    from(name) {
      const q = {
        _rows: tables[name] || [],
        select() { return q; },
        eq(col, val) { if (col === 'barber_id' || col === 'date') q._rows = q._rows.filter(r => r[col] === val || r[col] === undefined); return q; },
        in() { return q; }, not() { return q; }, lt() { return q; }, gt() { return q; },
        gte() { return q; }, lte() { return q; }, order() { return q; }, limit() { return q; },
        single() { return Promise.resolve({ data: q._rows[0] || null, error: null }); },
        maybeSingle() { return Promise.resolve({ data: q._rows[0] || null, error: null }); },
        then(res, rej) { return Promise.resolve({ data: q._rows, error: null }).then(res, rej); },
      };
      return q;
    },
  };
}

const sched = (status, over = {}) => ({
  barber_id: BARBER, outlet_id: 'csb', source: 'web', status,
  start_time: '2026-09-24T10:00:00Z', end_time: '2026-09-24T11:00:00Z', // 17:00–18:00 WIB
  ...over,
});

async function slotTimes(supabase) {
  const slots = await getAvailableSlots(supabase, {
    outletId: 'csb', date: DATE, durationMinutes: 60, barberId: BARBER, refDate: REF,
  });
  return slots.map(s => new Date(s.start).toISOString());
}
const SLOT_17 = '2026-09-24T10:00:00.000Z';

test('T1 cancelled web schedule does not block 17:00', async () => {
  assert.ok((await slotTimes(fakeSupabase({ schedules: [sched('cancelled')] }))).includes(SLOT_17));
});

test('T2 confirmed schedule blocks 17:00', async () => {
  assert.ok(!(await slotTimes(fakeSupabase({ schedules: [sched('confirmed')] }))).includes(SLOT_17));
});

test('T3 reserved (pending) schedule blocks 17:00', async () => {
  assert.ok(!(await slotTimes(fakeSupabase({ schedules: [sched('reserved')] }))).includes(SLOT_17));
  assert.ok(!(await slotTimes(fakeSupabase({
    bookings: [{ barber_id: BARBER, date: DATE, time: '17:00', duration: '60', status: 'pending' }],
  }))).includes(SLOT_17));
});

test('T4 cancelled + confirmed overlap -> still blocked', async () => {
  const s = fakeSupabase({ schedules: [sched('cancelled'), sched('confirmed')] });
  assert.ok(!(await slotTimes(s)).includes(SLOT_17));
});

test('T5 cancelled/expired stale Moka block does not block', async () => {
  for (const status of ['cancelled', 'expired', 'void']) {
    const s = fakeSupabase({ schedules: [sched(status, { source: 'moka', external_id: 'bill-1' })] });
    assert.ok((await slotTimes(s)).includes(SLOT_17), status);
  }
});

test('T6 active Moka open bill blocks (incl. unresolved-barber outlet-wide GoShow)', async () => {
  const moka = fakeSupabase({ schedules: [sched('confirmed', { source: 'moka', external_id: 'bill-2' })] });
  assert.ok(!(await slotTimes(moka)).includes(SLOT_17));
  const goshow = fakeSupabase({ schedules: [sched('in_progress', { source: 'moka', barber_id: null })] });
  assert.ok(!(await slotTimes(goshow)).includes(SLOT_17));
});

test('T7 cancelled group member (booking + schedule) frees Ragil slot, active one still blocks', async () => {
  const cancelled = fakeSupabase({
    bookings: [{ barber_id: BARBER, date: DATE, time: '17:00', duration: '60', status: 'cancelled' }],
    schedules: [sched('cancelled')],
  });
  assert.ok((await slotTimes(cancelled)).includes(SLOT_17));
  const mixed = fakeSupabase({
    bookings: [
      { barber_id: BARBER, date: DATE, time: '17:00', duration: '60', status: 'cancelled' },
      { barber_id: BARBER, date: DATE, time: '17:00', duration: '60', status: 'confirmed' },
    ],
  });
  assert.ok(!(await slotTimes(mixed)).includes(SLOT_17));
});

test('T8 reschedule: old slot cancelled -> free, new slot confirmed -> blocked', async () => {
  const s = fakeSupabase({
    schedules: [
      sched('cancelled'),
      sched('confirmed', { start_time: '2026-09-24T12:00:00Z', end_time: '2026-09-24T13:00:00Z' }), // 19:00 WIB
    ],
  });
  const times = await slotTimes(s);
  assert.ok(times.includes(SLOT_17));
  assert.ok(!times.includes('2026-09-24T12:00:00.000Z'));
});

test('T9 status matching is case/whitespace insensitive', async () => {
  for (const status of ['Cancelled', 'CANCELLED', 'cancelled', ' Canceled ']) {
    assert.equal(isBlockingStatus(status), false, status);
    assert.ok((await slotTimes(fakeSupabase({ schedules: [sched(status)] }))).includes(SLOT_17), status);
  }
  assert.equal(isBlockingStatus('Confirmed'), true);
  assert.equal(isBlockingStatus('in_progress'), true);
  assert.equal(isBlockingStatus('completed'), true);
  assert.equal(isBlockingStatus(undefined), true); // unknown -> fail-safe blocks
  assert.deepEqual(filterBlocking([{ status: 'Cancelled' }, { status: 'confirmed' }]).length, 1);
});

test('T10 production case: csb-ragil 2026-09-24 17:00, booking+schedule cancelled, source web', async () => {
  const s = fakeSupabase({
    bookings: [{ barber_id: BARBER, date: DATE, time: '17:00', duration: '60 menit', status: 'cancelled' }],
    schedules: [sched('cancelled')],
  });
  assert.ok((await slotTimes(s)).includes(SLOT_17));
});

test('T10b GET /api/schedules?blocking=1 (what booking.html consumes) drops cancelled, default keeps history', async () => {
  const rows = [sched('cancelled'), sched('Cancelled'), sched('confirmed')];
  const app = express();
  app.use('/api', createMokaRouter(fakeSupabase({ schedules: rows })));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.on('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/schedules`;
    const blocking = await (await fetch(`${base}?barberId=${BARBER}&date=${DATE}&blocking=1`)).json();
    assert.deepEqual(blocking.schedules.map(x => x.status), ['confirmed']);
    const all = await (await fetch(`${base}?barberId=${BARBER}&date=${DATE}`)).json();
    assert.equal(all.schedules.length, 3, 'admin/CRM listing keeps cancelled history');
  } finally {
    server.close();
  }
});
