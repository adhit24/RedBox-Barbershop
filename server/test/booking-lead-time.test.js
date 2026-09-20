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
  safeAdminTokenMatch,
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
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  const wh = [];
  allDays.forEach((d) => {
    wh.push({ barber_id: 'barber-bypass-1', day_of_week: d, open_time: '10:00', close_time: '21:00', is_off: false });
    wh.push({ barber_id: 'barber-csb-1', day_of_week: d, open_time: '10:00', close_time: '22:00', is_off: false });
  });

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
    barber_working_hours: wh,
    barber_date_overrides: [],
    bookings: seed.bookings || [],
    schedules: seed.schedules || [
      {
        id: 'sch-future-1',
        start_time: '2026-09-25T10:00:00+07:00',
        end_time: '2026-09-25T11:00:00+07:00',
        outlet_id: 'outlet-bypass-uuid',
        barber_id: 'barber-bypass-1',
        customer_id: 'cust-1',
        service_id: 'haircut',
        service_name: 'Haircut',
        price: 50000,
        status: 'confirmed',
      },
    ],
    home_service_jobs: seed.home_service_jobs || [
      {
        id: 'job-future-1',
        status: 'confirmed',
        address: 'Jl. Pemuda No. 10',
        reschedule_count: 0,
        schedule_id: 'sch-future-1',
      },
    ],
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
      if (proc === 'check_barber_overlap') {
        return Promise.resolve({ data: false, error: null });
      }
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

// ─────────────────────────────────────────────────────────────
// 5. AUDIT TESTS: ADMIN TOKEN SECURITY, INTEGRATION & RESCHEDULE
// ─────────────────────────────────────────────────────────────

test('Case 17: safeAdminTokenMatch unit verification (token benar, token salah, header kosong, secret tidak tersedia)', () => {
  const SECRET = 'admin-secret-xyz';

  // Token benar -> true
  assert.equal(safeAdminTokenMatch('admin-secret-xyz', SECRET), true, 'Exact secret must match');
  assert.equal(safeAdminTokenMatch(' admin-secret-xyz ', SECRET), true, 'Trimmed token must match');

  // Token salah -> false
  assert.equal(safeAdminTokenMatch('wrong-secret', SECRET), false, 'Wrong token must fail');
  assert.equal(safeAdminTokenMatch('admin-secret-xy', SECRET), false, 'Partial token must fail');

  // Header kosong / non-string -> false
  assert.equal(safeAdminTokenMatch('', SECRET), false, 'Empty token string must fail');
  assert.equal(safeAdminTokenMatch('   ', SECRET), false, 'Whitespace-only token must fail');
  assert.equal(safeAdminTokenMatch(undefined, SECRET), false, 'Undefined token must fail');
  assert.equal(safeAdminTokenMatch(null, SECRET), false, 'Null token must fail');
  assert.equal(safeAdminTokenMatch(12345, SECRET), false, 'Number token must fail');

  // Secret admin tidak tersedia -> false (must NEVER bypass)
  assert.equal(safeAdminTokenMatch(SECRET, ''), false, 'Empty secret must fail');
  assert.equal(safeAdminTokenMatch(SECRET, undefined), false, 'Undefined secret must fail');
  assert.equal(safeAdminTokenMatch(SECRET, null), false, 'Null secret must fail');
  assert.equal(safeAdminTokenMatch('', ''), false, 'Both empty must fail');
  assert.equal(safeAdminTokenMatch(undefined, undefined), false, 'Both undefined must fail');
});

test('Case 18: Admin token security audit on POST /api/bookings (correct token passes, wrong/empty/missing secret returns 422)', async () => {
  const fakeClient = fakeLeadTimeSupabase();
  const refTime = '2026-09-20T16:18:00+07:00';

  await withTestServer(fakeClient, async (base) => {
    // 1. Correct admin token -> bypasses lead time restriction (allowed)
    const resCorrect = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'test-admin-secret-2026',
        'x-test-reference-time': refTime,
      },
      body: JSON.stringify({
        name: 'Admin Customer',
        wa: '6281234567890',
        service_id: 'haircut',
        service: 'Haircut',
        price: 50000,
        duration: '30',
        barber_id: 'barber-bypass-1',
        date: '2026-09-20',
        time: '17:00',
        location: 'bypass',
      }),
    });
    assert.notEqual(resCorrect.status, 422, 'Correct admin token must bypass lead time restriction');

    // 2. Wrong admin token -> must NOT bypass (returns 422)
    const resWrong = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'wrong-password-here',
        'x-test-reference-time': refTime,
      },
      body: JSON.stringify({
        name: 'Attacker Admin',
        wa: '6281234567890',
        service_id: 'haircut',
        service: 'Haircut',
        price: 50000,
        duration: '30',
        barber_id: 'barber-bypass-1',
        date: '2026-09-20',
        time: '17:00',
        location: 'bypass',
      }),
    });
    assert.equal(resWrong.status, 422, 'Wrong admin token must be rejected with HTTP 422');

    // 3. Empty header -> must NOT bypass (returns 422)
    const resEmpty = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': '',
        'x-test-reference-time': refTime,
      },
      body: JSON.stringify({
        name: 'Public Customer',
        wa: '6281234567890',
        service_id: 'haircut',
        service: 'Haircut',
        price: 50000,
        duration: '30',
        barber_id: 'barber-bypass-1',
        date: '2026-09-20',
        time: '17:00',
        location: 'bypass',
      }),
    });
    assert.equal(resEmpty.status, 422, 'Empty admin token header must be rejected with HTTP 422');

    // 4. Secret unavailable in environment -> must NOT bypass even if header is missing or empty
    const origPassword = process.env.ADMIN_PASSWORD;
    try {
      delete process.env.ADMIN_PASSWORD;
      const resNoSecret = await fetch(`${base}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-reference-time': refTime,
        },
        body: JSON.stringify({
          name: 'Public Customer Without Secret In Env',
          wa: '6281234567890',
          service_id: 'haircut',
          service: 'Haircut',
          price: 50000,
          duration: '30',
          barber_id: 'barber-bypass-1',
          date: '2026-09-20',
          time: '17:00',
          location: 'bypass',
        }),
      });
      assert.equal(resNoSecret.status, 422, 'Missing ADMIN_PASSWORD environment variable must NOT grant bypass');
    } finally {
      process.env.ADMIN_PASSWORD = origPassword;
    }
  });
});

test('Case 19: Behavioral/Integration at 16:18 WIB — POST /api/bookings (17:00 fails 422, 18:00 passes)', async () => {
  const fakeClient = fakeLeadTimeSupabase();
  const refTime = '2026-09-20T16:18:00+07:00';

  await withTestServer(fakeClient, async (base) => {
    // 17:00 is within 42 minutes (< 60 min) -> MUST return 422
    const res17 = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-reference-time': refTime,
      },
      body: JSON.stringify({
        name: 'Budi 17.00',
        wa: '6281234567890',
        service_id: 'haircut',
        service: 'Haircut',
        price: 50000,
        duration: '30',
        barber_id: 'barber-bypass-1',
        date: '2026-09-20',
        time: '17:00',
        location: 'bypass',
      }),
    });
    assert.equal(res17.status, 422, 'At 16:18 WIB, booking 17:00 must return HTTP 422');
    const body17 = await res17.json();
    assert.equal(body17.error, 'BOOKING_LEAD_TIME_VIOLATION');
    assert.equal(body17.earliestAllowedSlot, '18:00');
    assert.equal(body17.timezone, 'Asia/Jakarta');

    // 18:00 is >= 60 minutes -> MUST pass lead time validation
    const res18 = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-reference-time': refTime,
      },
      body: JSON.stringify({
        name: 'Budi 18.00',
        wa: '6281234567890',
        service_id: 'haircut',
        service: 'Haircut',
        price: 50000,
        duration: '30',
        barber_id: 'barber-bypass-1',
        date: '2026-09-20',
        time: '18:00',
        location: 'bypass',
      }),
    });
    assert.notEqual(res18.status, 422, 'At 16:18 WIB, booking 18:00 must pass lead time validation');
  });
});

test('Case 20: Behavioral/Integration at 16:18 WIB — POST /api/bookings/group (17:00 fails 422, 18:00 passes)', async () => {
  const fakeClient = fakeLeadTimeSupabase();
  const refTime = '2026-09-20T16:18:00+07:00';

  await withTestServer(fakeClient, async (base) => {
    // Group with 17:00 -> fails with 422
    const res17 = await fetch(`${base}/api/bookings/group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-reference-time': refTime,
      },
      body: JSON.stringify({
        group_request_id: 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e',
        items: [
          {
            name: 'Person 1',
            wa: '628111111111',
            service_id: 'haircut',
            service: 'Haircut',
            price: 50000,
            duration: '30',
            barber_id: 'barber-bypass-1',
            date: '2026-09-20',
            time: '17:00',
            location: 'bypass',
          },
        ],
      }),
    });
    assert.equal(res17.status, 422, 'Group booking at 17:00 must return 422 at 16:18 WIB');
    const body17 = await res17.json();
    assert.equal(body17.error, 'BOOKING_LEAD_TIME_VIOLATION');
    assert.equal(body17.earliestAllowedSlot, '18:00');

    // Group with 18:00 -> passes lead time validation
    const res18 = await fetch(`${base}/api/bookings/group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-reference-time': refTime,
      },
      body: JSON.stringify({
        group_request_id: 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5f',
        items: [
          {
            name: 'Person 1',
            wa: '628111111111',
            service_id: 'haircut',
            service: 'Haircut',
            price: 50000,
            duration: '30',
            barber_id: 'barber-bypass-1',
            date: '2026-09-20',
            time: '18:00',
            location: 'bypass',
          },
        ],
      }),
    });
    assert.notEqual(res18.status, 422, 'Group booking at 18:00 must pass lead time validation at 16:18 WIB');
  });
});

test('Case 21: Behavioral/Integration at 16:18 WIB — POST /api/reservations (17:00 fails 422, 18:00 passes)', async () => {
  const fakeClient = fakeLeadTimeSupabase();
  const app = express();
  app.use(express.json());
  app.use('/api', createMokaRouter(fakeClient));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const refTime = '2026-09-20T16:18:00+07:00';

    // 17:00 reservation -> 422
    const res17 = await fetch(`${base}/api/reservations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-reference-time': refTime,
      },
      body: JSON.stringify({
        outletId: 'bypass',
        barberId: 'barber-bypass-1',
        serviceId: 'haircut',
        startTime: '2026-09-20T17:00:00+07:00',
        customer: { name: 'Reservation Test 17.00', phone: '08123456789' },
      }),
    });
    assert.equal(res17.status, 422, 'POST /api/reservations at 17:00 must return 422 at 16:18 WIB');
    const body17 = await res17.json();
    assert.equal(body17.error, 'BOOKING_LEAD_TIME_VIOLATION');
    assert.equal(body17.earliestAllowedSlot, '18:00');
    assert.equal(body17.timezone, 'Asia/Jakarta');

    // 18:00 reservation -> passes lead time (201 Created)
    const res18 = await fetch(`${base}/api/reservations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-reference-time': refTime,
      },
      body: JSON.stringify({
        outletId: 'bypass',
        barberId: 'barber-bypass-1',
        serviceId: 'haircut',
        startTime: '2026-09-20T18:00:00+07:00',
        customer: { name: 'Reservation Test 18.00', phone: '08123456789' },
      }),
    });
    assert.notEqual(res18.status, 422, 'POST /api/reservations at 18:00 must pass lead time validation');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('Case 22: Behavioral/Integration at 16:18 WIB — GET /api/availability (17:00 excluded, earliestAllowedSlot 18:00, timezone Asia/Jakarta)', async () => {
  const fakeClient = fakeLeadTimeSupabase();
  const app = express();
  app.use(express.json());
  app.use('/api', createMokaRouter(fakeClient));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const refTime = '2026-09-20T16:18:00+07:00';

    const res = await fetch(`${base}/api/availability?outletId=bypass&date=2026-09-20`, {
      headers: {
        'x-test-reference-time': refTime,
      },
    });
    assert.equal(res.status, 200);
    const body = await res.json();

    // Required metadata
    assert.equal(body.earliestAllowedSlot, '18:00', 'Metadata earliestAllowedSlot must be 18:00');
    assert.equal(body.timezone, 'Asia/Jakarta', 'Metadata timezone must be Asia/Jakarta');

    // Slot filtering: slot 17:00 must NOT be in available slots
    const slotTimes = body.slots.map((s) => {
      const wib = getWibDateTime(s.start);
      return wib.timeStr;
    });
    assert.equal(slotTimes.includes('17:00'), false, 'Slot 17:00 must not be returned');
    assert.ok(slotTimes.includes('18:00'), 'Slot 18:00 must be returned in available slots');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('Case 23: Customer reschedule lead-time audit — POST /api/home-service/reschedule (reschedule to 17:00 today rejected 422, 18:00 passes, admin override allowed, wrong admin token rejected 422)', async () => {
  const fakeClient = fakeLeadTimeSupabase();
  const origPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'test-admin-secret-2026';

  const app = express();
  app.use(express.json());
  app.use('/api', createMokaRouter(fakeClient));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const refTime = '2026-09-20T16:18:00+07:00';

    // 1. Customer attempts to reschedule booking from tomorrow to today at 17:00 (< 60 min) -> rejected 422
    const resCustomer17 = await fetch(`${base}/api/home-service/reschedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-reference-time': refTime,
      },
      body: JSON.stringify({
        jobId: 'job-future-1',
        newStartTime: '2026-09-20T17:00:00+07:00',
      }),
    });
    assert.equal(resCustomer17.status, 422, 'Customer reschedule to today at 17:00 must return HTTP 422');
    const bodyCustomer17 = await resCustomer17.json();
    assert.equal(bodyCustomer17.code, 'BOOKING_LEAD_TIME_VIOLATION');
    assert.equal(bodyCustomer17.earliestAllowedSlot, '18:00');
    assert.equal(bodyCustomer17.timezone, 'Asia/Jakarta');

    // 2. Customer reschedules to today at 18:00 (>= 60 min) -> passes lead time validation
    const resCustomer18 = await fetch(`${base}/api/home-service/reschedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-reference-time': refTime,
      },
      body: JSON.stringify({
        jobId: 'job-future-1',
        newStartTime: '2026-09-20T18:00:00+07:00',
      }),
    });
    assert.equal(resCustomer18.status, 200, 'Customer reschedule to today at 18:00 must succeed');
    const bodyCustomer18 = await resCustomer18.json();
    assert.equal(bodyCustomer18.ok, true);

    // 3. Admin with valid x-admin-token reschedules to today at 17:00 -> override allowed (200 OK)
    const resAdmin17 = await fetch(`${base}/api/home-service/reschedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'test-admin-secret-2026',
        'x-test-reference-time': refTime,
      },
      body: JSON.stringify({
        jobId: 'job-future-1',
        newStartTime: '2026-09-20T17:00:00+07:00',
      }),
    });
    assert.equal(resAdmin17.status, 200, 'Admin with valid token must be allowed to override reschedule lead time');
    const bodyAdmin17 = await resAdmin17.json();
    assert.equal(bodyAdmin17.ok, true);

    // 4. Attacker with wrong x-admin-token reschedules to 17:00 -> rejected 422
    const resWrongAdmin = await fetch(`${base}/api/home-service/reschedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'invalid-token-12345',
        'x-test-reference-time': refTime,
      },
      body: JSON.stringify({
        jobId: 'job-future-1',
        newStartTime: '2026-09-20T17:00:00+07:00',
      }),
    });
    assert.equal(resWrongAdmin.status, 422, 'Reschedule with invalid admin token must NOT bypass lead time');
  } finally {
    if (origPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = origPassword;
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
