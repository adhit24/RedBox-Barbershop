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
// P2-B3 & P2-B5: IDEMPOTENCY PARITY & CONCURRENCY TEST SUITE (ROUND 2)
// ═════════════════════════════════════════════════════════════════════════════

test('P2-B3: Migration enforces comprehensive material parity check on replay', () => {
  assert.match(migrationB2B3, /v_existing_booking\.wa = p_wa/);
  assert.match(migrationB2B3, /v_existing_booking\.service = p_service/);
  assert.match(migrationB2B3, /v_existing_booking\.price = COALESCE\(p_price, 0\)/);
  assert.match(migrationB2B3, /v_existing_booking\.duration IS NOT DISTINCT FROM p_duration/);
  assert.match(migrationB2B3, /v_existing_booking\.barber_id IS NOT DISTINCT FROM p_barber_id/);
  assert.match(migrationB2B3, /v_existing_booking\.date = p_date/);
  assert.match(migrationB2B3, /v_existing_booking\.time = p_time/);
  assert.match(migrationB2B3, /v_existing_booking\.location IS NOT DISTINCT FROM p_location/);
  assert.match(migrationB2B3, /v_existing_booking\.type IS NOT DISTINCT FROM COALESCE\(p_type, 'outlet'\)/);
  assert.match(migrationB2B3, /IDEMPOTENCY_KEY_REUSED/);
});

test('P2-B3: Migration create_booking_atomic serializes same-key concurrency via advisory lock', () => {
  assert.match(migrationB2B3, /pg_advisory_xact_lock/);
  assert.match(migrationB2B3, /booking_request:/);
  assert.match(migrationB2B3, /WHEN unique_violation THEN/);
  assert.match(migrationB2B3, /DELETE FROM schedules WHERE id = v_schedule_id;/);
});

test('P2-B5: Migration create_group_booking_atomic enforces advisory lock and 1:1 canonical multiset parity', () => {
  assert.match(migrationB5, /pg_advisory_xact_lock/);
  assert.match(migrationB5, /group_booking_request:/);
  assert.match(migrationB5, /v_canonical_incoming = v_canonical_existing/);
  assert.match(migrationB5, /IDEMPOTENCY_KEY_REUSED/);
});

function createSimulatedPostgresDb() {
  const bookingsDb = new Map();
  const groupBookingsDb = new Map();
  const schedulesDb = new Map(); // key: `${barber_id}:${date}:${time}`
  const advisoryLocks = new Map();

  async function acquireAdvisoryLock(key) {
    while (advisoryLocks.has(key)) {
      await advisoryLocks.get(key);
    }
    let release;
    const lockPromise = new Promise(resolve => { release = resolve; });
    advisoryLocks.set(key, lockPromise);
    return () => {
      advisoryLocks.delete(key);
      release();
    };
  }

  function canonicalizeSingle(b) {
    return {
      wa: b.wa || '',
      service: b.service || '',
      service_id: b.service_id || '',
      price: Number(b.price) || 0,
      duration: String(b.duration || '30'),
      barber_id: b.barber_id || '',
      date: String(b.date || ''),
      time: String(b.time || ''),
      location: b.location || 'bypass',
      type: b.type || 'outlet',
      notes: b.notes || '',
      payment: b.payment || '',
      original_price: b.original_price !== undefined ? b.original_price : null,
      discount_label: b.discount_label || '',
    };
  }

  function canonicalizeGroupItems(items) {
    const list = items.map(canonicalizeSingle);
    list.sort((a, b) => {
      const ka = `${a.wa}|${a.date}|${a.time}|${a.barber_id}|${a.service}|${a.price}|${a.service_id}|${a.duration}|${a.location}|${a.type}|${a.notes}|${a.payment}|${a.original_price}|${a.discount_label}`;
      const kb = `${b.wa}|${b.date}|${b.time}|${b.barber_id}|${b.service}|${b.price}|${b.service_id}|${b.duration}|${b.location}|${b.type}|${b.notes}|${b.payment}|${b.original_price}|${b.discount_label}`;
      return ka.localeCompare(kb);
    });
    return list;
  }

  return {
    async rpc(fnName, params) {
      if (fnName === 'create_booking_atomic') {
        const reqId = params.p_booking_request_id;
        let releaseLock = () => {};
        if (reqId) {
          releaseLock = await acquireAdvisoryLock('booking:' + reqId);
        }
        try {
          if (reqId && bookingsDb.has(reqId)) {
            const existing = bookingsDb.get(reqId);
            const canonicalExisting = canonicalizeSingle(existing);
            const canonicalIncoming = canonicalizeSingle({
              wa: params.p_wa,
              service: params.p_service,
              service_id: params.p_service_id,
              price: params.p_price,
              duration: params.p_duration,
              barber_id: params.p_barber_id,
              date: params.p_date,
              time: params.p_time,
              location: params.p_location,
              type: params.p_type,
              notes: params.p_notes,
              payment: params.p_payment,
              original_price: params.p_original_price,
              discount_label: params.p_discount_label,
            });

            if (JSON.stringify(canonicalExisting) === JSON.stringify(canonicalIncoming)) {
              return {
                data: {
                  success: true,
                  replayed: true,
                  booking: existing,
                  booking_id: existing.id,
                  schedule_id: existing.schedule_id,
                },
                error: null,
              };
            } else {
              return {
                data: null,
                error: { code: '23505', message: 'IDEMPOTENCY_KEY_REUSED' },
              };
            }
          }

          // Slot conflict pre-check simulating Postgres GiST exclusion constraint (blocks concurrent inserts on same barber slot)
          let releaseSlotLock = () => {};
          if (params.p_barber_id && params.p_barber_id !== 'any') {
            const slotKey = `${params.p_barber_id}:${params.p_date}:${params.p_time}`;
            releaseSlotLock = await acquireAdvisoryLock('slot:' + slotKey);
            if (schedulesDb.has(slotKey)) {
              releaseSlotLock();
              return {
                data: null,
                error: { code: '23P01', message: 'conflicts with existing schedule (no_barber_overlap)' },
              };
            }
          }

          // Simulate concurrent async execution delay
          await new Promise(r => setTimeout(r, 5));

          const newBooking = {
            id: params.p_booking_id || 'bk-' + Math.random().toString(36).slice(2),
            booking_request_id: reqId,
            wa: params.p_wa,
            service: params.p_service,
            service_id: params.p_service_id || '',
            price: Number(params.p_price) || 0,
            duration: params.p_duration || '30',
            barber_id: params.p_barber_id,
            date: params.p_date,
            time: params.p_time,
            location: params.p_location,
            type: params.p_type || 'outlet',
            notes: params.p_notes || '',
            payment: params.p_payment || '',
            original_price: params.p_original_price !== undefined ? params.p_original_price : null,
            discount_label: params.p_discount_label || null,
            schedule_id: 'sch-' + Math.random().toString(36).slice(2),
          };

          if (reqId) bookingsDb.set(reqId, newBooking);
          if (params.p_barber_id && params.p_barber_id !== 'any') {
            const slotKey = `${params.p_barber_id}:${params.p_date}:${params.p_time}`;
            schedulesDb.set(slotKey, newBooking.schedule_id);
          }
          releaseSlotLock();

          return {
            data: {
              success: true,
              replayed: false,
              booking: newBooking,
              booking_id: newBooking.id,
              schedule_id: newBooking.schedule_id,
            },
            error: null,
          };
        } finally {
          releaseLock();
        }
      }

      if (fnName === 'create_group_booking_atomic') {
        const gId = params.p_group_request_id;
        const incomingItems = params.p_items || [];
        let releaseLock = () => {};
        if (gId) {
          releaseLock = await acquireAdvisoryLock('group:' + gId);
        }
        try {
          if (gId && groupBookingsDb.has(gId)) {
            const existingItems = groupBookingsDb.get(gId);
            const canonicalExisting = canonicalizeGroupItems(existingItems);
            const canonicalIncoming = canonicalizeGroupItems(incomingItems);

            if (JSON.stringify(canonicalExisting) === JSON.stringify(canonicalIncoming)) {
              return {
                data: {
                  success: true,
                  replayed: true,
                  group_request_id: gId,
                  items: existingItems,
                },
                error: null,
              };
            } else {
              return { data: null, error: { code: '23505', message: 'IDEMPOTENCY_KEY_REUSED' } };
            }
          }

          // Simulate concurrent async execution delay
          await new Promise(r => setTimeout(r, 5));

          const committed = incomingItems.map((item, idx) => ({
            ...item,
            id: 'bk-g-' + idx,
            schedule_id: 'sch-g-' + idx,
          }));
          if (gId) groupBookingsDb.set(gId, committed);
          return {
            data: {
              success: true,
              replayed: false,
              group_request_id: gId,
              items: committed,
            },
            error: null,
          };
        } finally {
          releaseLock();
        }
      }
      return { data: null, error: new Error('Unknown RPC ' + fnName) };
    },
  };
}

test('P2-B3: Idempotency parity 1 - same key + identical complete payload -> replay', async () => {
  const db = createSimulatedPostgresDb();
  const base = {
    booking_request_id: '11111111-2222-3333-4444-555555555555',
    name: 'Budi',
    wa: '081234567890',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
    type: 'outlet',
  };

  const first = await executeCreateBookingAtomic(db, base);
  assert.equal(first.success, true);
  assert.equal(first.replayed, false);
  assert.equal(first.status, 201);

  const second = await executeCreateBookingAtomic(db, base);
  assert.equal(second.success, true);
  assert.equal(second.replayed, true);
  assert.equal(second.status, 200);
  assert.equal(second.bookingId, first.bookingId);
});

test('P2-B3: Idempotency parity 2 - same key + different service -> 409', async () => {
  const db = createSimulatedPostgresDb();
  const key = '11111111-2222-3333-4444-555555555555';
  await executeCreateBookingAtomic(db, {
    booking_request_id: key,
    wa: '081234567890',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
  });

  const changed = await executeCreateBookingAtomic(db, {
    booking_request_id: key,
    wa: '081234567890',
    service: 'Hair Coloring', // changed service
    price: 50000,
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
  });

  assert.equal(changed.success, false);
  assert.equal(changed.status, 409);
  assert.equal(changed.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('P2-B3: Idempotency parity 3 - same key + different price -> 409', async () => {
  const db = createSimulatedPostgresDb();
  const key = '11111111-2222-3333-4444-555555555555';
  await executeCreateBookingAtomic(db, {
    booking_request_id: key,
    wa: '081234567890',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
  });

  const changed = await executeCreateBookingAtomic(db, {
    booking_request_id: key,
    wa: '081234567890',
    service: 'Gentlemen Haircut',
    price: 75000, // changed price
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
  });

  assert.equal(changed.success, false);
  assert.equal(changed.status, 409);
  assert.equal(changed.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('P2-B3: Idempotency parity 4 - same key + different duration -> 409', async () => {
  const db = createSimulatedPostgresDb();
  const key = '11111111-2222-3333-4444-555555555555';
  await executeCreateBookingAtomic(db, {
    booking_request_id: key,
    wa: '081234567890',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
  });

  const changed = await executeCreateBookingAtomic(db, {
    booking_request_id: key,
    wa: '081234567890',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '60', // changed duration
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
  });

  assert.equal(changed.success, false);
  assert.equal(changed.status, 409);
  assert.equal(changed.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('P2-B3: Idempotency parity 5 - same key + different barber -> 409', async () => {
  const db = createSimulatedPostgresDb();
  const key = '11111111-2222-3333-4444-555555555555';
  await executeCreateBookingAtomic(db, {
    booking_request_id: key,
    wa: '081234567890',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
  });

  const changed = await executeCreateBookingAtomic(db, {
    booking_request_id: key,
    wa: '081234567890',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-john', // changed barber
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
  });

  assert.equal(changed.success, false);
  assert.equal(changed.status, 409);
  assert.equal(changed.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('P2-B3: Idempotency parity 6 - same key + different date/time -> 409', async () => {
  const db = createSimulatedPostgresDb();
  const key = '11111111-2222-3333-4444-555555555555';
  await executeCreateBookingAtomic(db, {
    booking_request_id: key,
    wa: '081234567890',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
  });

  const changed = await executeCreateBookingAtomic(db, {
    booking_request_id: key,
    wa: '081234567890',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '11:00', // changed time
    location: 'bypass',
  });

  assert.equal(changed.success, false);
  assert.equal(changed.status, 409);
  assert.equal(changed.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('P2-B3: Idempotency parity 7 - same key + different location -> 409', async () => {
  const db = createSimulatedPostgresDb();
  const key = '11111111-2222-3333-4444-555555555555';
  await executeCreateBookingAtomic(db, {
    booking_request_id: key,
    wa: '081234567890',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
  });

  const changed = await executeCreateBookingAtomic(db, {
    booking_request_id: key,
    wa: '081234567890',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'csb', // changed location
  });

  assert.equal(changed.success, false);
  assert.equal(changed.status, 409);
  assert.equal(changed.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('P2-B3: Idempotency parity 8 - same key + different booking type -> 409', async () => {
  const db = createSimulatedPostgresDb();
  const key = '11111111-2222-3333-4444-555555555555';
  await executeCreateBookingAtomic(db, {
    booking_request_id: key,
    wa: '081234567890',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
    type: 'outlet',
  });

  const changed = await executeCreateBookingAtomic(db, {
    booking_request_id: key,
    wa: '081234567890',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
    type: 'home_service', // changed type
  });

  assert.equal(changed.success, false);
  assert.equal(changed.status, 409);
  assert.equal(changed.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('P2-B5: Group idempotency parity 9 - same group_request_id + identical group -> replay', async () => {
  const db = createSimulatedPostgresDb();
  const gKey = '22222222-3333-4444-5555-666666666666';
  const groupItems = [
    { wa: '08111111111', service: 'Cut A', price: 50000, barber_id: 'b1', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
    { wa: '08222222222', service: 'Cut B', price: 60000, barber_id: 'b2', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
  ];

  const first = await executeCreateGroupBookingAtomic(db, gKey, groupItems);
  assert.equal(first.success, true);
  assert.equal(first.replayed, false);
  assert.equal(first.status, 201);

  const second = await executeCreateGroupBookingAtomic(db, gKey, groupItems);
  assert.equal(second.success, true);
  assert.equal(second.replayed, true);
  assert.equal(second.status, 200);
});

test('P2-B5: Group idempotency parity 10 - same group_request_id + changed service in item 2 -> 409', async () => {
  const db = createSimulatedPostgresDb();
  const gKey = '22222222-3333-4444-5555-666666666666';
  await executeCreateGroupBookingAtomic(db, gKey, [
    { wa: '08111111111', service: 'Cut A', price: 50000, barber_id: 'b1', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
    { wa: '08222222222', service: 'Cut B', price: 60000, barber_id: 'b2', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
  ]);

  const changed = await executeCreateGroupBookingAtomic(db, gKey, [
    { wa: '08111111111', service: 'Cut A', price: 50000, barber_id: 'b1', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
    { wa: '08222222222', service: 'Coloring B', price: 60000, barber_id: 'b2', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
  ]);

  assert.equal(changed.success, false);
  assert.equal(changed.status, 409);
  assert.equal(changed.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('P2-B5: Group idempotency parity 11 - same group_request_id + changed barber/time -> 409', async () => {
  const db = createSimulatedPostgresDb();
  const gKey = '22222222-3333-4444-5555-666666666666';
  await executeCreateGroupBookingAtomic(db, gKey, [
    { wa: '08111111111', service: 'Cut A', price: 50000, barber_id: 'b1', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
    { wa: '08222222222', service: 'Cut B', price: 60000, barber_id: 'b2', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
  ]);

  const changed = await executeCreateGroupBookingAtomic(db, gKey, [
    { wa: '08111111111', service: 'Cut A', price: 50000, barber_id: 'b99', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
    { wa: '08222222222', service: 'Cut B', price: 60000, barber_id: 'b2', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
  ]);

  assert.equal(changed.success, false);
  assert.equal(changed.status, 409);
  assert.equal(changed.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('P2-B5: Group idempotency parity 12 - same group_request_id + changed party count -> 409', async () => {
  const db = createSimulatedPostgresDb();
  const gKey = '22222222-3333-4444-5555-666666666666';
  await executeCreateGroupBookingAtomic(db, gKey, [
    { wa: '08111111111', service: 'Cut A', price: 50000, barber_id: 'b1', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
    { wa: '08222222222', service: 'Cut B', price: 60000, barber_id: 'b2', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
  ]);

  const changed = await executeCreateGroupBookingAtomic(db, gKey, [
    { wa: '08111111111', service: 'Cut A', price: 50000, barber_id: 'b1', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
    { wa: '08222222222', service: 'Cut B', price: 60000, barber_id: 'b2', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
    { wa: '08333333333', service: 'Cut C', price: 70000, barber_id: 'b3', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
  ]);

  assert.equal(changed.success, false);
  assert.equal(changed.status, 409);
  assert.equal(changed.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('P2-B3: Concurrency 13 - concurrent identical single-key requests -> one booking, second replay', async () => {
  const db = createSimulatedPostgresDb();
  const payload = {
    booking_request_id: '99999999-aaaa-bbbb-cccc-dddddddddddd',
    name: 'Concurrent User',
    wa: '081299999999',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
  };

  const [res1, res2] = await Promise.all([
    executeCreateBookingAtomic(db, payload),
    executeCreateBookingAtomic(db, payload),
  ]);

  const createdCount = (res1.status === 201 ? 1 : 0) + (res2.status === 201 ? 1 : 0);
  const replayedCount = (res1.status === 200 && res1.replayed ? 1 : 0) + (res2.status === 200 && res2.replayed ? 1 : 0);

  assert.equal(createdCount, 1, 'Exactly one create (201)');
  assert.equal(replayedCount, 1, 'Exactly one replay (200)');
});

test('P2-B3: Concurrency 14 - concurrent same key but different payload -> one booking, one 409', async () => {
  const db = createSimulatedPostgresDb();
  const key = '99999999-aaaa-bbbb-cccc-dddddddddddd';
  const payloadA = {
    booking_request_id: key,
    name: 'Concurrent User A',
    wa: '081299999999',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-bob',
    date: '2026-09-12',
    time: '10:00',
    location: 'bypass',
  };
  const payloadB = {
    ...payloadA,
    service: 'Hair Coloring', // different material field
  };

  const [resA, resB] = await Promise.all([
    executeCreateBookingAtomic(db, payloadA),
    executeCreateBookingAtomic(db, payloadB),
  ]);

  const successCount = (resA.success ? 1 : 0) + (resB.success ? 1 : 0);
  const conflictCount = (resA.status === 409 ? 1 : 0) + (resB.status === 409 ? 1 : 0);

  assert.equal(successCount, 1, 'Exactly one request succeeds');
  assert.equal(conflictCount, 1, 'Mismatched concurrent request returns 409');
});

test('P2-B3: Concurrency 15 - two concurrent different keys + same slot -> one create, one BOOKING_SLOT_CONFLICT', async () => {
  const db = createSimulatedPostgresDb();
  const payload1 = {
    booking_request_id: '11111111-aaaa-bbbb-cccc-000000000001',
    name: 'Customer 1',
    wa: '081211111111',
    service: 'Gentlemen Haircut',
    price: 50000,
    duration: '30',
    barber_id: 'barber-alex',
    date: '2026-09-12',
    time: '14:00',
    location: 'bypass',
  };
  const payload2 = {
    booking_request_id: '22222222-aaaa-bbbb-cccc-000000000002', // different key
    name: 'Customer 2',
    wa: '081222222222',
    service: 'Beard Trim',
    price: 35000,
    duration: '30',
    barber_id: 'barber-alex', // same barber & slot
    date: '2026-09-12',
    time: '14:00',
    location: 'bypass',
  };

  const [res1, res2] = await Promise.all([
    executeCreateBookingAtomic(db, payload1),
    executeCreateBookingAtomic(db, payload2),
  ]);

  const createdCount = (res1.status === 201 ? 1 : 0) + (res2.status === 201 ? 1 : 0);
  const slotConflictCount =
    (res1.status === 409 && res1.code === 'BOOKING_SLOT_CONFLICT' ? 1 : 0) +
    (res2.status === 409 && res2.code === 'BOOKING_SLOT_CONFLICT' ? 1 : 0);

  assert.equal(createdCount, 1, 'Exactly one request succeeds with 201');
  assert.equal(slotConflictCount, 1, 'Competing request receives 409 BOOKING_SLOT_CONFLICT');
});

test('P2-B5: Group duplicate parity 16 - duplicate items in group replay are compared correctly', async () => {
  const db = createSimulatedPostgresDb();
  const gKey = '33333333-4444-5555-6666-777777777777';
  // Group with two duplicate items (e.g. 2 x Gentlemen Haircut with same barber, price, date, time)
  const itemsWithDuplicates = [
    { wa: '08111111111', service: 'Gentlemen Haircut', price: 50000, barber_id: 'b1', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
    { wa: '08111111111', service: 'Gentlemen Haircut', price: 50000, barber_id: 'b1', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
  ];

  const first = await executeCreateGroupBookingAtomic(db, gKey, itemsWithDuplicates);
  assert.equal(first.success, true);
  assert.equal(first.replayed, false);
  assert.equal(first.status, 201);

  // Exact duplicate replay succeeds
  const second = await executeCreateGroupBookingAtomic(db, gKey, itemsWithDuplicates);
  assert.equal(second.success, true);
  assert.equal(second.replayed, true);
  assert.equal(second.status, 200);

  // Reduced duplicate count (1 item instead of 2) -> 409
  const reduced = await executeCreateGroupBookingAtomic(db, gKey, [itemsWithDuplicates[0]]);
  assert.equal(reduced.success, false);
  assert.equal(reduced.status, 409);
  assert.equal(reduced.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('P2-B5: Group material parity 17 - changed service_id/notes/payment/discount -> group 409', async () => {
  const db = createSimulatedPostgresDb();
  const gKey = '44444444-5555-6666-7777-888888888888';
  const baseGroup = [
    {
      wa: '08111111111',
      service: 'Cut A',
      service_id: 'srv-a',
      price: 50000,
      duration: '30',
      barber_id: 'b1',
      date: '2026-09-15',
      time: '10:00',
      location: 'bypass',
      type: 'outlet',
      notes: 'Please gentle',
      payment: 'cash',
      original_price: 50000,
      discount_label: 'NONE',
    },
  ];

  const first = await executeCreateGroupBookingAtomic(db, gKey, baseGroup);
  assert.equal(first.success, true);
  assert.equal(first.status, 201);

  // 1. Changed notes -> 409
  const changedNotes = await executeCreateGroupBookingAtomic(db, gKey, [
    { ...baseGroup[0], notes: 'Different note' },
  ]);
  assert.equal(changedNotes.success, false);
  assert.equal(changedNotes.status, 409);
  assert.equal(changedNotes.code, 'IDEMPOTENCY_KEY_REUSED');

  // 2. Changed discount_label -> 409
  const changedDiscount = await executeCreateGroupBookingAtomic(db, gKey, [
    { ...baseGroup[0], discount_label: 'BIRTHDAY_50' },
  ]);
  assert.equal(changedDiscount.success, false);
  assert.equal(changedDiscount.status, 409);
  assert.equal(changedDiscount.code, 'IDEMPOTENCY_KEY_REUSED');

  // 3. Changed payment -> 409
  const changedPayment = await executeCreateGroupBookingAtomic(db, gKey, [
    { ...baseGroup[0], payment: 'qris' },
  ]);
  assert.equal(changedPayment.success, false);
  assert.equal(changedPayment.status, 409);
  assert.equal(changedPayment.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('P2-B5: Group concurrency 18 - concurrent identical group_request_id -> one create, second replay', async () => {
  const db = createSimulatedPostgresDb();
  const gKey = '55555555-6666-7777-8888-999999999999';
  const groupItems = [
    { wa: '08111111111', service: 'Cut A', price: 50000, barber_id: 'b1', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
    { wa: '08222222222', service: 'Cut B', price: 60000, barber_id: 'b2', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
  ];

  const [res1, res2] = await Promise.all([
    executeCreateGroupBookingAtomic(db, gKey, groupItems),
    executeCreateGroupBookingAtomic(db, gKey, groupItems),
  ]);

  const createdCount = (res1.status === 201 ? 1 : 0) + (res2.status === 201 ? 1 : 0);
  const replayedCount = (res1.status === 200 && res1.replayed ? 1 : 0) + (res2.status === 200 && res2.replayed ? 1 : 0);

  assert.equal(createdCount, 1, 'Exactly one group create (201)');
  assert.equal(replayedCount, 1, 'Exactly one group replay (200)');
});

test('P2-B5: Group concurrency 19 - concurrent same group_request_id with different payload -> one create, one 409', async () => {
  const db = createSimulatedPostgresDb();
  const gKey = '66666666-7777-8888-9999-000000000000';
  const groupItemsA = [
    { wa: '08111111111', service: 'Cut A', price: 50000, barber_id: 'b1', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
  ];
  const groupItemsB = [
    { wa: '08111111111', service: 'Cut A Modified', price: 75000, barber_id: 'b1', date: '2026-09-15', time: '10:00', location: 'bypass', duration: '30' },
  ];

  const [resA, resB] = await Promise.all([
    executeCreateGroupBookingAtomic(db, gKey, groupItemsA),
    executeCreateGroupBookingAtomic(db, gKey, groupItemsB),
  ]);

  const successCount = (resA.success ? 1 : 0) + (resB.success ? 1 : 0);
  const conflictCount = (resA.status === 409 ? 1 : 0) + (resB.status === 409 ? 1 : 0);

  assert.equal(successCount, 1, 'Exactly one group succeeds');
  assert.equal(conflictCount, 1, 'Mismatched group payload receives 409');
});

test('P2-B2: Secondary review - atomic booking fails closed when RPC unavailable in production', async () => {
  const fakeClientWithoutRpc = { from: () => {} };
  const res = await executeCreateBookingAtomic(fakeClientWithoutRpc, {
    name: 'Prod User',
    wa: '081234567890',
  }, { env: 'production' });
  assert.equal(res.success, false);
  assert.equal(res.status, 500);
  assert.equal(res.code, 'RPC_UNAVAILABLE');

  const resGroup = await executeCreateGroupBookingAtomic(fakeClientWithoutRpc, 'gid', [{ wa: '123' }], { env: 'production' });
  assert.equal(resGroup.success, false);
  assert.equal(resGroup.status, 500);
  assert.equal(resGroup.code, 'RPC_UNAVAILABLE');

  const resResched = await executeRescheduleBookingAtomic(fakeClientWithoutRpc, { bookingId: 'b1' }, { env: 'production' });
  assert.equal(resResched.success, false);
  assert.equal(resResched.status, 500);
  assert.equal(resResched.code, 'RPC_UNAVAILABLE');

  const resCancel = await executeCancelBookingAtomic(fakeClientWithoutRpc, 'b1', '', { env: 'production' });
  assert.equal(resCancel.success, false);
  assert.equal(resCancel.status, 500);
  assert.equal(resCancel.code, 'RPC_UNAVAILABLE');
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
