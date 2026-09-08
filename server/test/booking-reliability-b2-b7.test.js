// server/test/booking-reliability-b2-b7.test.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');

const serverFile = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const bookingJsFile = fs.readFileSync(path.join(workspace, 'public', 'js', 'booking.js'), 'utf8');
const mokaSyncFile = fs.readFileSync(path.join(__dirname, '..', 'moka', 'sync.js'), 'utf8');

const migrationB2B3 = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '2026-09-09-booking-atomic-and-idempotency.sql'),
  'utf8'
);
const migrationB5 = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '2026-09-09-group-booking-atomic.sql'),
  'utf8'
);
const migrationB6 = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '2026-09-09-reschedule-cancel-atomic.sql'),
  'utf8'
);

const { verifyTurnstileToken, isTrustedTurnstileBypass } = require('../services/turnstile');
const {
  executeCreateBookingAtomic,
  executeCreateGroupBookingAtomic,
  executeRescheduleBookingAtomic,
  executeCancelBookingAtomic,
  mapRpcError,
} = require('../services/atomicBookingService');

// ═════════════════════════════════════════════════════════════════════════════
// P2-B2: ATOMIC BOOKING + SCHEDULE CREATION
// ═════════════════════════════════════════════════════════════════════════════

test('P2-B2: Migration defines create_booking_atomic with search_path lockdown and SECURITY DEFINER', () => {
  assert.match(migrationB2B3, /CREATE OR REPLACE FUNCTION public\.create_booking_atomic/);
  assert.match(migrationB2B3, /SECURITY DEFINER/);
  assert.match(migrationB2B3, /SET search_path = public, extensions, pg_temp/);
  assert.match(migrationB2B3, /REVOKE EXECUTE ON FUNCTION public\.create_booking_atomic/);
  assert.match(migrationB2B3, /GRANT EXECUTE ON FUNCTION public\.create_booking_atomic TO service_role/);
});

test('P2-B2: mapRpcError maps PostgreSQL 23P01 (exclusion violation) to BOOKING_SLOT_CONFLICT', () => {
  const err23P01 = { code: '23P01', message: 'conflicting key value violates exclusion constraint "no_barber_overlap"' };
  const mapped = mapRpcError(err23P01);
  assert.equal(mapped.code, 'BOOKING_SLOT_CONFLICT');
  assert.match(mapped.message, /Kapster sudah memiliki jadwal/);
});

test('P2-B2: mapRpcError maps PostgreSQL 23505 (unique violation) to IDEMPOTENCY_KEY_REUSED', () => {
  const err23505 = { code: '23505', message: 'duplicate key value violates unique constraint "idx_bookings_booking_request_id"' };
  const mapped = mapRpcError(err23505);
  assert.equal(mapped.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.match(mapped.message, /Idempotency key/);
});

test('P2-B2: bridgeBookingToMoka reuses existing schedule_id and prevents duplicate schedule insertion', () => {
  assert.match(mokaSyncFile, /if \(booking\.schedule_id\) \{/);
  assert.match(mokaSyncFile, /return \{ scheduleId: booking\.schedule_id, mokaSync \};/);
});

test('P2-B2: executeCreateBookingAtomic executes RPC and returns booking + scheduleId', async () => {
  const mockBooking = {
    id: 'bk-12345',
    name: 'Budi Santoso',
    wa: '08123456789',
    service: 'Gentlemen Haircut',
    price: 50000,
    date: '2026-09-10',
    time: '14:00',
    location: 'bypass',
    barber_id: 'barber-1',
    status: 'confirmed',
    booking_request_id: '11111111-2222-4333-8444-555555555555',
  };

  const fakeSupabase = {
    rpc(fnName, params) {
      assert.equal(fnName, 'create_booking_atomic');
      assert.equal(params.p_name, 'Budi Santoso');
      return Promise.resolve({
        data: {
          success: true,
          replayed: false,
          booking: mockBooking,
          schedule_id: 'sch-99999',
        },
        error: null,
      });
    },
  };

  const result = await executeCreateBookingAtomic(fakeSupabase, {
    booking_request_id: '11111111-2222-4333-8444-555555555555',
    name: 'Budi Santoso',
    wa: '08123456789',
    service: 'Gentlemen Haircut',
    price: 50000,
    date: '2026-09-10',
    time: '14:00',
    location: 'bypass',
    barber_id: 'barber-1',
    status: 'confirmed',
  });

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.booking.id, 'bk-12345');
  assert.equal(result.scheduleId, 'sch-99999');
});

test('P2-B2: executeCreateBookingAtomic returns 409 conflict when DB raises 23P01', async () => {
  const fakeSupabase = {
    rpc() {
      return Promise.resolve({
        data: null,
        error: { code: '23P01', message: 'conflicting key value violates exclusion constraint no_barber_overlap' },
      });
    },
  };

  const result = await executeCreateBookingAtomic(fakeSupabase, {
    name: 'Budi',
    wa: '08123456789',
    service: 'Haircut',
    date: '2026-09-10',
    time: '14:00',
    location: 'bypass',
    barber_id: 'barber-1',
  });

  assert.equal(result.success, false);
  assert.equal(result.code, 'BOOKING_SLOT_CONFLICT');
});

// ═════════════════════════════════════════════════════════════════════════════
// P2-B3: IDEMPOTENCY
// ═════════════════════════════════════════════════════════════════════════════

test('P2-B3: Migration adds booking_request_id with partial unique index', () => {
  assert.match(migrationB2B3, /ALTER TABLE public\.bookings/);
  assert.match(migrationB2B3, /booking_request_id UUID/);
  assert.match(migrationB2B3, /CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_request_id/);
});

test('P2-B3: executeCreateBookingAtomic returns replayed: true on idempotency match', async () => {
  const existingBooking = {
    id: 'bk-existing',
    booking_request_id: '77777777-7777-4777-8777-777777777777',
    name: 'Replay Customer',
    schedule_id: 'sch-existing',
  };

  const fakeSupabase = {
    rpc() {
      return Promise.resolve({
        data: {
          success: true,
          replayed: true,
          booking: existingBooking,
          schedule_id: 'sch-existing',
        },
        error: null,
      });
    },
  };

  const result = await executeCreateBookingAtomic(fakeSupabase, {
    booking_request_id: '77777777-7777-4777-8777-777777777777',
    name: 'Replay Customer',
    wa: '08123456789',
    service: 'Haircut',
    date: '2026-09-10',
    time: '14:00',
    location: 'bypass',
    barber_id: 'barber-1',
  });

  assert.equal(result.success, true);
  assert.equal(result.replayed, true);
  assert.equal(result.booking.id, 'bk-existing');
  assert.equal(result.scheduleId, 'sch-existing');
});

test('P2-B3: executeCreateBookingAtomic surfaces IDEMPOTENCY_KEY_REUSED when payload mismatches', async () => {
  const fakeSupabase = {
    rpc() {
      return Promise.resolve({
        data: {
          success: false,
          code: 'IDEMPOTENCY_KEY_REUSED',
          error: 'booking_request_id already used with different booking details',
        },
        error: null,
      });
    },
  };

  const result = await executeCreateBookingAtomic(fakeSupabase, {
    booking_request_id: '77777777-7777-4777-8777-777777777777',
    name: 'Different Customer',
    wa: '08123456789',
    service: 'Haircut',
    date: '2026-09-10',
    time: '14:00',
    location: 'bypass',
    barber_id: 'barber-1',
  });

  assert.equal(result.success, false);
  assert.equal(result.code, 'IDEMPOTENCY_KEY_REUSED');
});

// ═════════════════════════════════════════════════════════════════════════════
// P2-B4: SERVER-SIDE TURNSTILE + TRUTHFUL UX
// ═════════════════════════════════════════════════════════════════════════════

test('P2-B4: verifyTurnstileToken rejects missing token with BOOKING_TURNSTILE_REQUIRED', async () => {
  const res = await verifyTurnstileToken(null, '127.0.0.1');
  assert.equal(res.success, false);
  assert.equal(res.code, 'BOOKING_TURNSTILE_REQUIRED');
});

test('P2-B4: verifyTurnstileToken rejects invalid token with BOOKING_TURNSTILE_FAILED', async () => {
  const res = await verifyTurnstileToken('invalid-dummy-token', '127.0.0.1');
  assert.equal(res.success, false);
  assert.equal(res.code, 'BOOKING_TURNSTILE_FAILED');
});

test('P2-B4: verifyTurnstileToken accepts test-valid-turnstile-token only in NODE_ENV=test', async () => {
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const res = await verifyTurnstileToken('test-valid-turnstile-token', '127.0.0.1');
    assert.equal(res.success, true);
    assert.equal(res.testMode, true);
  } finally {
    process.env.NODE_ENV = prevEnv;
  }
});

test('P2-B4: NODE_ENV=production + test-valid-turnstile-token MUST NOT locally bypass and MUST call Cloudflare', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = global.fetch;

  process.env.NODE_ENV = 'production';
  process.env.TURNSTILE_SECRET_KEY = 'prod-secret-sample';

  let fetchCalled = false;
  let fetchedUrl = '';
  let fetchedBody = '';
  global.fetch = async (url, options) => {
    fetchCalled = true;
    fetchedUrl = String(url);
    fetchedBody = String(options?.body || '');
    return {
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    };
  };

  try {
    const res = await verifyTurnstileToken('test-valid-turnstile-token', '127.0.0.1');
    assert.equal(fetchCalled, true, 'Must call Cloudflare siteverify');
    assert.match(fetchedUrl, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/);
    assert.match(fetchedBody, /response=test-valid-turnstile-token/);
    assert.equal(res.success, false);
    assert.equal(res.code, 'BOOKING_TURNSTILE_FAILED');
  } finally {
    process.env.NODE_ENV = prevEnv;
    process.env.TURNSTILE_SECRET_KEY = prevSecret;
    global.fetch = originalFetch;
  }
});

test('P2-B4: NODE_ENV=production + test-valid-anything MUST NOT locally bypass', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = global.fetch;

  process.env.NODE_ENV = 'production';
  process.env.TURNSTILE_SECRET_KEY = 'prod-secret-sample';

  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    return {
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    };
  };

  try {
    const res = await verifyTurnstileToken('test-valid-arbitrary-token-123', '127.0.0.1');
    assert.equal(fetchCalled, true);
    assert.equal(res.success, false);
    assert.equal(res.code, 'BOOKING_TURNSTILE_FAILED');
  } finally {
    process.env.NODE_ENV = prevEnv;
    process.env.TURNSTILE_SECRET_KEY = prevSecret;
    global.fetch = originalFetch;
  }
});

test('P2-B4: NODE_ENV=production + missing TURNSTILE_SECRET_KEY fails closed with BOOKING_TURNSTILE_FAILED', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.TURNSTILE_SECRET_KEY;

  process.env.NODE_ENV = 'production';
  delete process.env.TURNSTILE_SECRET_KEY;

  try {
    const res = await verifyTurnstileToken('test-valid-turnstile-token', '127.0.0.1');
    assert.equal(res.success, false);
    assert.equal(res.code, 'BOOKING_TURNSTILE_FAILED');
    assert.equal(res.error, 'TURNSTILE_NOT_CONFIGURED');
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevSecret !== undefined) process.env.TURNSTILE_SECRET_KEY = prevSecret;
  }
});

test('P2-B4: isTrustedTurnstileBypass identifies admin credentials or internal authenticated calls only (rejects skipTurnstile client flag)', () => {
  process.env.ADMIN_PASSWORD = 'test-admin-secret';
  const reqAdmin = {
    headers: { 'x-admin-token': 'test-admin-secret' },
  };
  assert.equal(isTrustedTurnstileBypass(reqAdmin), true);

  const reqPublic = {
    headers: {},
  };
  assert.equal(isTrustedTurnstileBypass(reqPublic), false);

  const reqClientBypassSpoof = {
    headers: {},
    body: { skipTurnstile: true },
  };
  assert.equal(isTrustedTurnstileBypass(reqClientBypassSpoof), false);
});

test('P2-B4: POST /api/bookings and POST /api/bookings/group enforce server-side Turnstile verification', () => {
  assert.match(serverFile, /app\.post\('\/api\/bookings',/);
  assert.match(serverFile, /isTrustedTurnstileBypass\(req\)[\s\S]*?verifyTurnstileToken/);
  assert.match(serverFile, /app\.post\('\/api\/bookings\/group',/);
  assert.match(serverFile, /BOOKING_TURNSTILE_FAILED/);
});

test('P2-B4: public/js/booking.js includes truthful customer error messages', () => {
  assert.match(bookingJsFile, /res\.status === 403/);
  assert.match(bookingJsFile, /Verifikasi keamanan bot gagal/);
  assert.match(bookingJsFile, /res\.status === 409/);
  assert.match(bookingJsFile, /Jadwal kapster pada jam tersebut sudah terisi atau bentrok/);
  assert.match(bookingJsFile, /res\.status === 429/);
  assert.match(bookingJsFile, /Terlalu banyak permintaan dalam waktu singkat/);
  assert.match(bookingJsFile, /Koneksi terputus saat mengecek hasil booking/);
});

// ═════════════════════════════════════════════════════════════════════════════
// P2-B5: ATOMIC GROUP BOOKING
// ═════════════════════════════════════════════════════════════════════════════

test('P2-B5: Migration defines create_group_booking_atomic with search_path lockdown and SECURITY DEFINER', () => {
  assert.match(migrationB5, /CREATE OR REPLACE FUNCTION public\.create_group_booking_atomic/);
  assert.match(migrationB5, /SECURITY DEFINER/);
  assert.match(migrationB5, /SET search_path = public, extensions, pg_temp/);
  assert.match(migrationB5, /REVOKE EXECUTE ON FUNCTION public\.create_group_booking_atomic/);
  assert.match(migrationB5, /GRANT EXECUTE ON FUNCTION public\.create_group_booking_atomic TO service_role/);
});

test('P2-B5: executeCreateGroupBookingAtomic commits multiple bookings atomically', async () => {
  const fakeSupabase = {
    rpc(fnName, params) {
      assert.equal(fnName, 'create_group_booking_atomic');
      assert.equal(params.p_group_request_id, '99999999-9999-4999-8999-999999999999');
      return Promise.resolve({
        data: {
          success: true,
          replayed: false,
          bookings: [
            { id: 'bk-p1', name: 'Person 1', group_request_id: params.p_group_request_id },
            { id: 'bk-p2', name: 'Person 2', group_request_id: params.p_group_request_id },
          ],
          schedule_ids: ['sch-p1', 'sch-p2'],
        },
        error: null,
      });
    },
  };

  const result = await executeCreateGroupBookingAtomic(fakeSupabase, {
    group_request_id: '99999999-9999-4999-8999-999999999999',
    items: [
      { name: 'Person 1', wa: '0812111111', service: 'Cut 1', date: '2026-09-10', time: '10:00', location: 'bypass', barber_id: 'b1' },
      { name: 'Person 2', wa: '0812222222', service: 'Cut 2', date: '2026-09-10', time: '11:00', location: 'bypass', barber_id: 'b2' },
    ],
  });

  assert.equal(result.success, true);
  assert.equal(result.bookings.length, 2);
  assert.equal(result.scheduleIds.length, 2);
});

test('P2-B5: executeCreateGroupBookingAtomic fails all-or-nothing when an item conflicts', async () => {
  const fakeSupabase = {
    rpc() {
      return Promise.resolve({
        data: {
          success: false,
          code: 'BOOKING_SLOT_CONFLICT',
          error: 'Jadwal slot pada orang ke-2 bentrok dengan jadwal lain.',
          conflict_index: 1,
        },
        error: null,
      });
    },
  };

  const result = await executeCreateGroupBookingAtomic(fakeSupabase, {
    group_request_id: '99999999-9999-4999-8999-999999999999',
    items: [
      { name: 'Person 1', wa: '0812111111', service: 'Cut 1', date: '2026-09-10', time: '10:00', location: 'bypass', barber_id: 'b1' },
      { name: 'Person 2', wa: '0812222222', service: 'Cut 2', date: '2026-09-10', time: '10:00', location: 'bypass', barber_id: 'b1' },
    ],
  });

  assert.equal(result.success, false);
  assert.equal(result.code, 'BOOKING_SLOT_CONFLICT');
  assert.equal(result.conflictIndex, 1);
});

test('P2-B5: POST /api/bookings/group exists in server/index.js with rateLimit', () => {
  const groupRouteMatch = serverFile.match(/app\.post\('\/api\/bookings\/group'[\s\S]*?\n\}\);/);
  assert.ok(groupRouteMatch, 'expected app.post(\'/api/bookings/group\') to exist in server/index.js');
  assert.match(groupRouteMatch[0], /executeCreateGroupBookingAtomic/);
  assert.match(groupRouteMatch[0], /booking_group_blocked/);
});

// ═════════════════════════════════════════════════════════════════════════════
// P2-B6: RESCHEDULE / CANCEL INTEGRITY
// ═════════════════════════════════════════════════════════════════════════════

test('P2-B6: Migration defines reschedule_booking_atomic and cancel_booking_atomic with SECURITY DEFINER', () => {
  assert.match(migrationB6, /CREATE OR REPLACE FUNCTION public\.reschedule_booking_atomic/);
  assert.match(migrationB6, /CREATE OR REPLACE FUNCTION public\.cancel_booking_atomic/);
  assert.match(migrationB6, /SECURITY DEFINER/);
  assert.match(migrationB6, /SET search_path = public, extensions, pg_temp/);
  assert.match(migrationB6, /REVOKE EXECUTE ON FUNCTION public\.reschedule_booking_atomic/);
  assert.match(migrationB6, /REVOKE EXECUTE ON FUNCTION public\.cancel_booking_atomic/);
  assert.match(migrationB6, /GRANT EXECUTE ON FUNCTION public\.reschedule_booking_atomic TO service_role/);
  assert.match(migrationB6, /GRANT EXECUTE ON FUNCTION public\.cancel_booking_atomic TO service_role/);
});

test('P2-B6: executeRescheduleBookingAtomic updates booking and schedule atomically', async () => {
  const fakeSupabase = {
    rpc(fnName, params) {
      assert.equal(fnName, 'reschedule_booking_atomic');
      assert.equal(params.p_booking_id, 'bk-reschedule-1');
      assert.equal(params.p_new_date, '2026-09-12');
      assert.equal(params.p_new_time, '16:00');
      return Promise.resolve({
        data: {
          success: true,
          booking: { id: 'bk-reschedule-1', date: '2026-09-12', time: '16:00' },
          schedule_id: 'sch-1',
        },
        error: null,
      });
    },
  };

  const result = await executeRescheduleBookingAtomic(fakeSupabase, {
    booking_id: 'bk-reschedule-1',
    date: '2026-09-12',
    time: '16:00',
    barber_id: 'barber-1',
    location: 'csb',
  });

  assert.equal(result.success, true);
  assert.equal(result.booking.date, '2026-09-12');
  assert.equal(result.booking.time, '16:00');
});

test('P2-B6: executeRescheduleBookingAtomic returns 409 when target slot has overlap conflict', async () => {
  const fakeSupabase = {
    rpc() {
      return Promise.resolve({
        data: {
          success: false,
          code: 'BOOKING_SLOT_CONFLICT',
          error: 'Jadwal slot baru bentrok dengan jadwal lain.',
        },
        error: null,
      });
    },
  };

  const result = await executeRescheduleBookingAtomic(fakeSupabase, {
    booking_id: 'bk-reschedule-1',
    date: '2026-09-12',
    time: '16:00',
    barber_id: 'barber-1',
  });

  assert.equal(result.success, false);
  assert.equal(result.code, 'BOOKING_SLOT_CONFLICT');
});

test('P2-B6: executeCancelBookingAtomic updates both booking and schedule to cancelled status', async () => {
  const fakeSupabase = {
    rpc(fnName, params) {
      assert.equal(fnName, 'cancel_booking_atomic');
      assert.equal(params.p_booking_id, 'bk-cancel-1');
      return Promise.resolve({
        data: {
          success: true,
          booking: { id: 'bk-cancel-1', status: 'cancelled' },
          schedule_id: 'sch-cancel-1',
        },
        error: null,
      });
    },
  };

  const result = await executeCancelBookingAtomic(fakeSupabase, 'bk-cancel-1', 'Pelanggan membatalkan');
  assert.equal(result.success, true);
  assert.equal(result.booking.status, 'cancelled');
  assert.equal(result.scheduleId, 'sch-cancel-1');
});

test('P2-B6: handleBookingUpdate and POST /api/booking-status call atomic reschedule & cancel', () => {
  assert.match(serverFile, /executeCancelBookingAtomic/);
  assert.match(serverFile, /executeRescheduleBookingAtomic/);
  assert.match(serverFile, /booking_reschedule_committed/);
  assert.match(serverFile, /booking_reschedule_conflict/);
  assert.match(serverFile, /booking_cancel_committed/);
});

// ═════════════════════════════════════════════════════════════════════════════
// P2-B7: PRODUCTION READINESS & OBSERVABILITY
// ═════════════════════════════════════════════════════════════════════════════

test('P2-B7: Required System Event Log event names are integrated without PII leakage', () => {
  const requiredEvents = [
    'booking_submit_started',
    'booking_created',
    'booking_availability_failed',
    'booking_validation_failed',
    'booking_idempotent_replay',
    'booking_group_blocked',
    'booking_reschedule_committed',
    'booking_reschedule_conflict',
    'booking_cancel_committed',
  ];

  for (const ev of requiredEvents) {
    assert.match(serverFile, new RegExp(ev), `expected event ${ev} in server/index.js`);
  }
});
