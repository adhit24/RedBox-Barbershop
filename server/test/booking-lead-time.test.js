'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const {
  TIMEZONE,
  MIN_LEAD_TIME_MINUTES,
  getWibDateTime,
  getBranchLastSlot,
  calculateEarliestAllowedSlot,
  isBookingLeadTimeAllowed,
  filterSlotsForLeadTime,
  timeStrToMinutes,
} = require('../utils/bookingLeadTime');
const createMokaRouter = require('../moka/routes');

// ─────────────────────────────────────────────────────────────
// 1. UNIT TESTS: CORE MATHEMATICAL FORMULA & TIMING BOUNDARIES
// ─────────────────────────────────────────────────────────────

test('Case 1: Sekarang 16.00 WIB -> slot 17.00 boleh dipilih', () => {
  const refTime = new Date('2026-09-20T16:00:00+07:00');
  const earliest = calculateEarliestAllowedSlot(refTime);
  assert.equal(earliest, '17:00');

  const check17 = isBookingLeadTimeAllowed({
    bookingDate: '2026-09-20',
    bookingTime: '17:00',
    branch: 'bypass',
    refDate: refTime,
  });
  assert.equal(check17.allowed, true);
  assert.equal(check17.earliestAllowedSlot, '17:00');

  const check16 = isBookingLeadTimeAllowed({
    bookingDate: '2026-09-20',
    bookingTime: '16:00',
    branch: 'bypass',
    refDate: refTime,
  });
  assert.equal(check16.allowed, false);
  assert.equal(check16.error, 'BOOKING_LEAD_TIME_VIOLATION');
});

test('Case 2: Sekarang 16.01 WIB -> slot 17.00 ditolak, slot 18.00 boleh', () => {
  const refTime = new Date('2026-09-20T16:01:00+07:00');
  const earliest = calculateEarliestAllowedSlot(refTime);
  assert.equal(earliest, '18:00');

  const check17 = isBookingLeadTimeAllowed({
    bookingDate: '2026-09-20',
    bookingTime: '17:00',
    branch: 'bypass',
    refDate: refTime,
  });
  assert.equal(check17.allowed, false);
  assert.equal(check17.error, 'BOOKING_LEAD_TIME_VIOLATION');
  assert.equal(check17.earliestAllowedSlot, '18:00');

  const check18 = isBookingLeadTimeAllowed({
    bookingDate: '2026-09-20',
    bookingTime: '18:00',
    branch: 'bypass',
    refDate: refTime,
  });
  assert.equal(check18.allowed, true);
});

test('Case 3: Sekarang 16.18 WIB -> slot paling awal 18.00 (contoh utama bisnis)', () => {
  const refTime = new Date('2026-09-20T16:18:00+07:00');
  const earliest = calculateEarliestAllowedSlot(refTime);
  assert.equal(earliest, '18:00');

  // Slots 10:00 through 17:00 are disallowed
  const forbiddenSlots = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
  for (const slot of forbiddenSlots) {
    const res = isBookingLeadTimeAllowed({
      bookingDate: '2026-09-20',
      bookingTime: slot,
      branch: 'bypass',
      refDate: refTime,
    });
    assert.equal(res.allowed, false, `Slot ${slot} must be forbidden at 16:18 WIB`);
    assert.equal(res.error, 'BOOKING_LEAD_TIME_VIOLATION');
  }

  // Slots 18:00 through 20:00 are allowed
  const allowedSlots = ['18:00', '19:00', '20:00'];
  for (const slot of allowedSlots) {
    const res = isBookingLeadTimeAllowed({
      bookingDate: '2026-09-20',
      bookingTime: slot,
      branch: 'bypass',
      refDate: refTime,
    });
    assert.equal(res.allowed, true, `Slot ${slot} must be allowed at 16:18 WIB`);
  }

  // Verify filtering on available slots array for Bypass
  const bypassGrid = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
  const bypassFiltered = filterSlotsForLeadTime({
    slots: bypassGrid,
    bookingDate: '2026-09-20',
    branch: 'bypass',
    refDate: refTime,
  });
  assert.deepEqual(bypassFiltered.filteredSlots, ['18:00', '19:00', '20:00']);
  assert.equal(bypassFiltered.earliestAllowedSlot, '18:00');

  // Verify filtering on available slots array for CSB (which has up to 21:00)
  const csbGrid = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
  const csbFiltered = filterSlotsForLeadTime({
    slots: csbGrid,
    bookingDate: '2026-09-20',
    branch: 'csb',
    refDate: refTime,
  });
  assert.deepEqual(csbFiltered.filteredSlots, ['18:00', '19:00', '20:00', '21:00']);
  assert.equal(csbFiltered.earliestAllowedSlot, '18:00');
});

test('Case 4: Sekarang 16.59 WIB -> slot paling awal 18.00', () => {
  const refTime = new Date('2026-09-20T16:59:00+07:00');
  const earliest = calculateEarliestAllowedSlot(refTime);
  assert.equal(earliest, '18:00');

  const check17 = isBookingLeadTimeAllowed({
    bookingDate: '2026-09-20',
    bookingTime: '17:00',
    branch: 'csb',
    refDate: refTime,
  });
  assert.equal(check17.allowed, false);
  assert.equal(check17.earliestAllowedSlot, '18:00');

  const check18 = isBookingLeadTimeAllowed({
    bookingDate: '2026-09-20',
    bookingTime: '18:00',
    branch: 'csb',
    refDate: refTime,
  });
  assert.equal(check18.allowed, true);
});

test('Case 4b: Sekarang 17.00 WIB -> slot paling awal 18.00', () => {
  const refTime = new Date('2026-09-20T17:00:00+07:00');
  const earliest = calculateEarliestAllowedSlot(refTime);
  assert.equal(earliest, '18:00');

  const check18 = isBookingLeadTimeAllowed({
    bookingDate: '2026-09-20',
    bookingTime: '18:00',
    branch: 'tegal',
    refDate: refTime,
  });
  assert.equal(check18.allowed, true);
});

test('Case 5: Booking untuk besok -> seluruh slot sesuai jadwal tetap tersedia (tidak terkena batas 60 menit)', () => {
  // Sekarang 16.18 WIB pada 2026-09-20
  const refTime = new Date('2026-09-20T16:18:00+07:00');
  // Booking untuk besok 2026-09-21 jam 10:00
  const checkTomorrowMorning = isBookingLeadTimeAllowed({
    bookingDate: '2026-09-21',
    bookingTime: '10:00',
    branch: 'bypass',
    refDate: refTime,
  });
  assert.equal(checkTomorrowMorning.allowed, true);

  const fullGrid = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
  const filtered = filterSlotsForLeadTime({
    slots: fullGrid,
    bookingDate: '2026-09-21',
    branch: 'bypass',
    refDate: refTime,
  });
  assert.deepEqual(filtered.filteredSlots, fullGrid, 'All tomorrow slots must remain available');
  assert.equal(filtered.isClosedToday, false);
});

test('Case 6: Server berjalan dalam UTC -> hasil perhitungan tetap mengikuti WIB (Asia/Jakarta)', () => {
  // 16:18 WIB in UTC is 09:18 UTC (UTC+7)
  const utcDate = new Date('2026-09-20T09:18:00Z');
  const wib = getWibDateTime(utcDate);
  assert.equal(wib.dateStr, '2026-09-20');
  assert.equal(wib.timeStr, '16:18');
  assert.equal(wib.hour, 16);
  assert.equal(wib.minute, 18);

  const earliest = calculateEarliestAllowedSlot(utcDate);
  assert.equal(earliest, '18:00');

  const check = isBookingLeadTimeAllowed({
    bookingDate: '2026-09-20',
    bookingTime: '17:00',
    branch: 'bypass',
    refDate: utcDate,
  });
  assert.equal(check.allowed, false);
  assert.equal(check.error, 'BOOKING_LEAD_TIME_VIOLATION');
  assert.equal(check.earliestAllowedSlot, '18:00');
});

test('Case 7: Batas waktu melewati slot terakhir cabang -> tidak ada slot hari ini', () => {
  // Non-CSB branches (Bypass, Kuningan, Tegal, Samadikun, Sumber): last slot 20:00
  // At 19:01 WIB, +60 min = 20:01 -> earliest = 21:00 > 20:00 -> NO SLOTS TODAY
  const ref1901 = new Date('2026-09-20T19:01:00+07:00');
  const slotsNonCsb = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
  const resBypass = filterSlotsForLeadTime({
    slots: slotsNonCsb,
    bookingDate: '2026-09-20',
    branch: 'bypass',
    refDate: ref1901,
  });
  assert.equal(resBypass.isClosedToday, true);
  assert.deepEqual(resBypass.filteredSlots, []);

  // CSB Mall: last slot 21:00
  // At 20:00 WIB, +60 min = 21:00 -> earliest = 21:00 <= 21:00 -> slot 21:00 IS available
  const ref2000 = new Date('2026-09-20T20:00:00+07:00');
  const slotsCsb = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
  const resCsb2000 = filterSlotsForLeadTime({
    slots: slotsCsb,
    bookingDate: '2026-09-20',
    branch: 'csb',
    refDate: ref2000,
  });
  assert.equal(resCsb2000.isClosedToday, false);
  assert.deepEqual(resCsb2000.filteredSlots, ['21:00']);

  // At 20:01 WIB, +60 min = 21:01 -> earliest = 22:00 > 21:00 -> NO SLOTS TODAY
  const ref2001 = new Date('2026-09-20T20:01:00+07:00');
  const resCsb2001 = filterSlotsForLeadTime({
    slots: slotsCsb,
    bookingDate: '2026-09-20',
    branch: 'csb',
    refDate: ref2001,
  });
  assert.equal(resCsb2001.isClosedToday, true);
  assert.deepEqual(resCsb2001.filteredSlots, []);
});

test('Case 8: Aturan berlaku konsisten pada seluruh cabang aktif (Bypass, Kuningan, CSB, Tegal, dll.)', () => {
  const branches = ['bypass', 'kuningan', 'csb', 'tegal', 'samadikun', 'sumber', 'cabang-baru'];
  const ref1618 = new Date('2026-09-20T16:18:00+07:00');

  for (const branch of branches) {
    const check17 = isBookingLeadTimeAllowed({
      bookingDate: '2026-09-20',
      bookingTime: '17:00',
      branch,
      refDate: ref1618,
    });
    assert.equal(check17.allowed, false, `Branch ${branch} must reject 17:00 at 16:18`);
    assert.equal(check17.error, 'BOOKING_LEAD_TIME_VIOLATION');
    assert.equal(check17.earliestAllowedSlot, '18:00');

    const check18 = isBookingLeadTimeAllowed({
      bookingDate: '2026-09-20',
      bookingTime: '18:00',
      branch,
      refDate: ref1618,
    });
    assert.equal(check18.allowed, true, `Branch ${branch} must allow 18:00 at 16:18`);
  }
});

test('Case 9: Flow admin / backoffice dikecualikan dari batas lead time', () => {
  const ref1618 = new Date('2026-09-20T16:18:00+07:00');
  const adminCheck = isBookingLeadTimeAllowed({
    bookingDate: '2026-09-20',
    bookingTime: '16:30',
    branch: 'bypass',
    refDate: ref1618,
    isAdmin: true,
  });
  assert.equal(adminCheck.allowed, true, 'Admin must be able to book immediate or past lead-time slots');
});

// ─────────────────────────────────────────────────────────────
// 2. INTEGRATION TESTS: EXPRESS API ENDPOINTS
// ─────────────────────────────────────────────────────────────

function makeQueryableTable(rows, tableName) {
  return function queryable() {
    let filters = [];
    let wantSingle = false;
    let wantMaybeSingle = false;
    let action = 'select';
    let payload = null;
    let upsertOpts = {};

    const api = {
      select() { return api; },
      insert(data) { action = 'insert'; payload = Array.isArray(data) ? data : [data]; return api; },
      upsert(data, opts = {}) { action = 'upsert'; payload = data; upsertOpts = opts; return api; },
      update(data) { action = 'update'; payload = data; return api; },
      eq(col, val) { filters.push((r) => r[col] === val); return api; },
      in(col, vals) { filters.push((r) => vals.includes(r[col])); return api; },
      not(col, opText, val) {
        const list = String(val).replace(/[()"']/g, '').split(',').filter(Boolean);
        filters.push((r) => !list.includes(r[col]));
        return api;
      },
      lt(col, val) { filters.push((r) => new Date(r[col]).getTime() < new Date(val).getTime()); return api; },
      gt(col, val) { filters.push((r) => new Date(r[col]).getTime() > new Date(val).getTime()); return api; },
      single() { wantSingle = true; return api; },
      maybeSingle() { wantMaybeSingle = true; return api; },
      then(onFulfilled, onRejected) { return Promise.resolve(execute()).then(onFulfilled, onRejected); },
    };

    function execute() {
      if (action === 'insert') {
        const inserted = payload.map((p, i) => ({ id: p.id || `${tableName}-id-${rows.length + i + 1}`, ...p }));
        rows.push(...inserted);
        return { data: wantSingle ? inserted[0] : inserted, error: null };
      }
      const matches = rows.filter((r) => filters.every((f) => f(r)));
      if (wantSingle) return { data: matches[0] || null, error: matches[0] ? null : { code: 'PGRST116', message: 'not found' } };
      if (wantMaybeSingle) return { data: matches[0] || null, error: null };
      return { data: matches, error: null };
    }
    return api;
  };
}

function fakeLeadTimeSupabase(seed = {}) {
  const store = {
    barbers: seed.barbers || [
      { id: 'barber-bypass-1', name: 'Abdul', is_active: true, branch: 'bypass', outlet_id: 'outlet-bypass-uuid' },
      { id: 'barber-csb-1', name: 'Rian', is_active: true, branch: 'csb', outlet_id: 'outlet-csb-uuid' },
    ],
    outlets: [
      { id: 'outlet-bypass-uuid', slug: 'bypass', name: 'Bypass' },
      { id: 'outlet-csb-uuid', slug: 'csb', name: 'CSB Mall' },
    ],
    services: [
      { id: 'haircut', name: 'Haircut', duration_minutes: 30, price: 50000 },
    ],
    barber_working_hours: [
      { barber_id: 'barber-bypass-1', day_of_week: new Date().getDay(), open_time: '10:00', close_time: '21:00', is_off: false },
      { barber_id: 'barber-csb-1', day_of_week: new Date().getDay(), open_time: '10:00', close_time: '22:00', is_off: false },
    ],
    barber_date_overrides: [],
    bookings: seed.bookings || [],
    schedules: seed.schedules || [],
    customers: seed.customers || [],
    system_event_logs: [],
  };

  return {
    _store: store,
    from(table) {
      if (!store[table]) store[table] = [];
      return makeQueryableTable(store[table], table)();
    },
    rpc(proc, params) {
      if (proc === 'create_booking_atomic') {
        const newBooking = { id: 'bk-' + Date.now(), ...params };
        store.bookings.push(newBooking);
        return Promise.resolve({ data: { success: true, booking_id: newBooking.id }, error: null });
      }
      if (proc === 'create_group_booking_atomic') {
        const items = params.items || [];
        const createdBookings = items.map((it, idx) => ({ id: `bk-grp-${idx}`, ...it }));
        store.bookings.push(...createdBookings);
        return Promise.resolve({ data: { success: true, bookings: createdBookings }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

async function withTestServer(fakeClient, fn) {
  const supabaseJsPath = require.resolve('@supabase/supabase-js');
  const indexPath = require.resolve('../index.js');

  const savedEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    DATABASE_TYPE: process.env.DATABASE_TYPE,
  };
  process.env.SUPABASE_URL = 'https://fake-project.supabase.test';
  process.env.SUPABASE_SERVICE_KEY = 'fake-service-role-key';
  process.env.ADMIN_PASSWORD = 'test-admin-secret-2026';
  delete process.env.DATABASE_TYPE;

  const savedSupabaseJs = require.cache[supabaseJsPath];
  require.cache[supabaseJsPath] = {
    id: supabaseJsPath, filename: supabaseJsPath, loaded: true, children: [], paths: [],
    exports: { createClient: () => fakeClient },
  };
  delete require.cache[indexPath];

  let app;
  try {
    app = require('../index.js');
  } finally {
    if (savedSupabaseJs) require.cache[supabaseJsPath] = savedSupabaseJs;
    else delete require.cache[supabaseJsPath];
  }

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[indexPath];
    Object.entries(savedEnv).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    });
  }
}

test('Case 10: Direct API call POST /api/bookings for forbidden slot is rejected with HTTP 422', async () => {
  const fakeClient = fakeLeadTimeSupabase();
  const wibNow = getWibDateTime();
  const todayStr = wibNow.dateStr;
  const forbiddenTime = '10:00';

  const earliest = calculateEarliestAllowedSlot();
  if (timeStrToMinutes(forbiddenTime) < timeStrToMinutes(earliest)) {
    await withTestServer(fakeClient, async (base) => {
      const res = await fetch(`${base}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Lead Time Test Customer',
          wa: '6281234567890',
          service_id: 'haircut',
          service: 'Haircut',
          price: 50000,
          duration: '30',
          barber_id: 'barber-bypass-1',
          date: todayStr,
          time: forbiddenTime,
          location: 'bypass',
        }),
      });

      assert.equal(res.status, 422, 'Expected HTTP 422 for lead-time violation');
      const body = await res.json();
      assert.equal(body.error, 'BOOKING_LEAD_TIME_VIOLATION');
      assert.ok(body.message.includes('minimal 1 jam'));
      assert.equal(body.timezone, 'Asia/Jakarta');
      assert.equal(body.earliestAllowedSlot, earliest);
    });
  }
});

test('Case 11: Direct API call POST /api/bookings for tomorrow is allowed through lead-time gate', async () => {
  const fakeClient = fakeLeadTimeSupabase();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tomorrowStr = getWibDateTime(tomorrow).dateStr;

  await withTestServer(fakeClient, async (base) => {
    const res = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Advance Booking Customer',
        wa: '6281234567890',
        service_id: 'haircut',
        service: 'Haircut',
        price: 50000,
        duration: '30',
        barber_id: 'barber-bypass-1',
        date: tomorrowStr,
        time: '11:00',
        location: 'bypass',
      }),
    });

    assert.notEqual(res.status, 422, 'Advance booking must not be rejected with lead time 422');
  });
});

test('Case 12: Admin request with x-admin-token bypasses 60-minute lead time restriction', async () => {
  const fakeClient = fakeLeadTimeSupabase();
  const wibNow = getWibDateTime();
  const todayStr = wibNow.dateStr;

  await withTestServer(fakeClient, async (base) => {
    const res = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'test-admin-secret-2026',
      },
      body: JSON.stringify({
        name: 'Admin Walkin Customer',
        wa: '6281234567890',
        service_id: 'haircut',
        service: 'Haircut',
        price: 50000,
        duration: '30',
        barber_id: 'barber-bypass-1',
        date: todayStr,
        time: '10:00',
        location: 'bypass',
        status: 'confirmed',
      }),
    });

    assert.notEqual(res.status, 422, 'Admin with valid token must not be rejected with 422');
  });
});

test('Case 13: Group booking POST /api/bookings/group rejects slot violation with 422 and conflictIndex', async () => {
  const fakeClient = fakeLeadTimeSupabase();
  const wibNow = getWibDateTime();
  const todayStr = wibNow.dateStr;
  const earliest = calculateEarliestAllowedSlot();
  const forbiddenTime = '10:00';

  if (timeStrToMinutes(forbiddenTime) < timeStrToMinutes(earliest)) {
    await withTestServer(fakeClient, async (base) => {
      const res = await fetch(`${base}/api/bookings/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_request_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
          items: [
            {
              name: 'Person 1 Valid Tomorrow',
              wa: '628111111111',
              service_id: 'haircut',
              service: 'Haircut',
              price: 50000,
              duration: '30',
              barber_id: 'barber-bypass-1',
              date: '2026-09-25',
              time: '14:00',
              location: 'bypass',
            },
            {
              name: 'Person 2 Invalid Today',
              wa: '628222222222',
              service_id: 'haircut',
              service: 'Haircut',
              price: 50000,
              duration: '30',
              barber_id: 'barber-bypass-1',
              date: todayStr,
              time: forbiddenTime,
              location: 'bypass',
            },
          ],
        }),
      });

      assert.equal(res.status, 422, 'Expected HTTP 422 for group booking lead-time violation');
      const body = await res.json();
      assert.equal(body.error, 'BOOKING_LEAD_TIME_VIOLATION');
      assert.equal(body.conflictIndex, 1, 'Expected conflictIndex to pinpoint Person 2 (index 1)');
    });
  }
});

test('Case 14: GET /api/availability includes serverNow and earliestAllowedSlot', async () => {
  const fakeClient = fakeLeadTimeSupabase();
  const app = express();
  app.use(express.json());
  app.use('/api', createMokaRouter(fakeClient));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const today = getWibDateTime().dateStr;
    const res = await fetch(`${base}/api/availability?outletId=bypass&date=${today}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.serverNow, 'Expected serverNow in availability response');
    assert.equal(body.timezone, 'Asia/Jakarta');
    assert.ok(body.earliestAllowedSlot, 'Expected earliestAllowedSlot for today');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('Case 15: POST /api/reservations validates lead time and returns 422 for same-day violation', async () => {
  const fakeClient = fakeLeadTimeSupabase();
  const app = express();
  app.use(express.json());
  app.use('/api', createMokaRouter(fakeClient));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const today = getWibDateTime().dateStr;
    const earliest = calculateEarliestAllowedSlot();
    const forbiddenTime = '10:00';

    if (timeStrToMinutes(forbiddenTime) < timeStrToMinutes(earliest)) {
      const res = await fetch(`${base}/api/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outletId: 'bypass',
          barberId: 'barber-bypass-1',
          serviceId: 'haircut',
          startTime: `${today}T${forbiddenTime}:00+07:00`,
          customer: { name: 'Direct Reservation Customer', phone: '08123456789' },
        }),
      });

      assert.equal(res.status, 422, 'Expected HTTP 422 on lead time violation');
      const body = await res.json();
      assert.equal(body.error, 'BOOKING_LEAD_TIME_VIOLATION');
      assert.equal(body.earliestAllowedSlot, earliest);
    }
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('Case 16: UMD pattern exposes RedboxBookingLeadTime to browser root/globalThis', () => {
  const src = require('node:fs').readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'booking-lead-time.js'),
    'utf8'
  );
  assert.match(src, /root\.RedboxBookingLeadTime = api/);
  assert.match(src, /typeof module === 'object' && module\.exports/);
});
