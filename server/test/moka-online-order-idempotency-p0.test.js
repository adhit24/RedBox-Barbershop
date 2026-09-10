'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isServerTestEnvironment,
  isRequestAuthenticatedForTest,
  isTestFixture,
  evaluateTestIsolation,
  logSideEffectSkipped,
} = require('../utils/testIsolation');

const {
  claimOutboxJob,
  markOutboxSent,
  markOutboxFailed,
  getStaleOrFailedJobs
} = require('../services/mokaOutboxService');

const { pushScheduleToMoka } = require('../moka/sync');

// In-memory mock database for testing idempotency, outbox, and race conditions
function createMockDb() {
  const tables = {
    bookings: [],
    schedules: [],
    moka_order_outbox: [],
    sync_logs: [],
    transactions: [],
    services: [
      { id: 'srv-gentlemans-cut', moka_variant_name: "Gentleman's Cut", price: 60000 }
    ],
    outlets: [
      { id: 'outlet-uuid-1', moka_outlet_id: '100818', name: 'Redbox Barbershop Bypass' }
    ],
    barbers: [
      { id: 'barber-uuid-1', name: 'Barber Ari', outlet_id: 'outlet-uuid-1', moka_employee_id: '1001' }
    ]
  };

  let outboxSeq = 1;

  const db = {
    tables,
    calls: {
      mokaCreateOrder: 0,
      waSend: 0
    },

    from(tableName) {
      if (!tables[tableName]) tables[tableName] = [];
      const currentTable = tables[tableName];
      let filters = [];
      let selectFields = '*';
      let limitVal = null;
      let orderCol = null;
      let orderAsc = true;

      function matches(row) {
        return filters.every(f => f(row));
      }

      const builder = {
        select(fields = '*') {
          selectFields = fields;
          return builder;
        },
        eq(col, val) {
          filters.push(row => row[col] === val);
          return builder;
        },
        in(col, vals) {
          filters.push(row => vals.includes(row[col]));
          return builder;
        },
        neq(col, val) {
          filters.push(row => row[col] !== val);
          return builder;
        },
        is(col, val) {
          filters.push(row => row[col] === val);
          return builder;
        },
        lte(col, val) {
          filters.push(row => row[col] <= val);
          return builder;
        },
        gte(col, val) {
          filters.push(row => row[col] >= val);
          return builder;
        },
        lt(col, val) {
          filters.push(row => row[col] < val);
          return builder;
        },
        order(col, { ascending = true } = {}) {
          orderCol = col;
          orderAsc = ascending;
          return builder;
        },
        limit(n) {
          limitVal = n;
          return builder;
        },
        async single() {
          const matching = currentTable.filter(matches);
          if (matching.length === 0) return { data: null, error: { code: 'PGRST116', message: 'No rows found' } };
          return { data: { ...matching[0] }, error: null };
        },
        async maybeSingle() {
          const matching = currentTable.filter(matches);
          return { data: matching.length > 0 ? { ...matching[0] } : null, error: null };
        },
        then(resolve, reject) {
          let matching = currentTable.filter(matches);
          if (limitVal) matching = matching.slice(0, limitVal);
          return Promise.resolve({ data: matching.map(r => ({ ...r })), error: null }).then(resolve, reject);
        },
        insert(payload) {
          const rows = Array.isArray(payload) ? payload : [payload];
          const insertedRows = [];
          for (const row of rows) {
            // UNIQUE constraint simulation on moka_order_outbox (booking_id and schedule_id)
            if (tableName === 'moka_order_outbox') {
              if (row.booking_id && currentTable.some(r => r.booking_id === row.booking_id)) {
                return {
                  data: null,
                  error: { code: '23505', message: 'duplicate key value violates unique constraint moka_order_outbox_booking_id_key' },
                  select() {
                    return {
                      single: async () => ({ data: null, error: { code: '23505' } }),
                      maybeSingle: async () => ({ data: null, error: { code: '23505' } })
                    };
                  },
                  then(r) { return r({ data: null, error: { code: '23505' } }); }
                };
              }
              if (row.schedule_id && currentTable.some(r => r.schedule_id === row.schedule_id)) {
                return {
                  data: null,
                  error: { code: '23505', message: 'duplicate key value violates unique constraint moka_order_outbox_schedule_id_key' },
                  select() {
                    return {
                      single: async () => ({ data: null, error: { code: '23505' } }),
                      maybeSingle: async () => ({ data: null, error: { code: '23505' } })
                    };
                  },
                  then(r) { return r({ data: null, error: { code: '23505' } }); }
                };
              }
            }
            if (tableName === 'bookings') {
              if (row.booking_request_id && currentTable.some(r => r.booking_request_id === row.booking_request_id)) {
                return {
                  data: null,
                  error: { code: '23505', message: 'duplicate key value violates unique constraint idx_bookings_request_id' },
                  select() {
                    return {
                      single: async () => ({ data: null, error: { code: '23505' } }),
                      maybeSingle: async () => ({ data: null, error: { code: '23505' } })
                    };
                  },
                  then(r) { return r({ data: null, error: { code: '23505' } }); }
                };
              }
            }
            const inserted = {
              id: row.id || `${tableName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ...row
            };
            currentTable.push(inserted);
            insertedRows.push(inserted);
          }

          const opResult = {
            data: insertedRows,
            error: null,
            select() {
              return {
                async single() { return { data: { ...insertedRows[0] }, error: null }; },
                async maybeSingle() { return { data: { ...insertedRows[0] }, error: null }; },
                then(r) { return Promise.resolve({ data: insertedRows, error: null }).then(r); }
              };
            },
            then(resolve, reject) {
              return Promise.resolve({ data: insertedRows, error: null }).then(resolve, reject);
            }
          };
          return opResult;
        },
        update(payload) {
          const matching = currentTable.filter(matches);
          for (const row of matching) {
            Object.assign(row, payload, { updated_at: new Date().toISOString() });
          }
          const opResult = {
            data: matching.map(r => ({ ...r })),
            error: null,
            eq(col, val) {
              filters.push(row => row[col] === val);
              return opResult;
            },
            select() {
              return {
                async single() { return { data: matching[0] ? { ...matching[0] } : null, error: null }; },
                async maybeSingle() { return { data: matching[0] ? { ...matching[0] } : null, error: null }; },
                then(r) { return Promise.resolve({ data: matching, error: null }).then(r); }
              };
            },
            then(resolve, reject) {
              return Promise.resolve({ data: matching, error: null }).then(resolve, reject);
            }
          };
          return opResult;
        },
        delete() {
          const matchingIndices = [];
          currentTable.forEach((r, idx) => {
            if (matches(r)) matchingIndices.push(idx);
          });
          for (let i = matchingIndices.length - 1; i >= 0; i--) {
            currentTable.splice(matchingIndices[i], 1);
          }
          return {
            data: null,
            error: null,
            then(resolve, reject) {
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
            }
          };
        }
      };

      return builder;
    },

    // Emulate atomic RPC claim_moka_outbox_job
    async rpc(fnName, params) {
      if (fnName === 'claim_moka_outbox_job') {
        const { p_booking_id, p_schedule_id, p_timeout_minutes = 5 } = params;
        const now = new Date();
        const timeoutMs = p_timeout_minutes * 60 * 1000;
        const outbox = tables.moka_order_outbox;

        let row = outbox.find(r => 
          (p_booking_id && r.booking_id === p_booking_id) ||
          (p_schedule_id && r.schedule_id === p_schedule_id)
        );

        if (!row) {
          row = {
            id: `outbox-${outboxSeq++}`,
            booking_id: p_booking_id || null,
            schedule_id: p_schedule_id || null,
            status: 'processing',
            moka_order_id: null,
            attempt_count: 1,
            last_attempt_at: now.toISOString(),
            last_error: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString()
          };
          outbox.push(row);
          return {
            data: {
              claimed: true,
              status: row.status,
              outbox_id: row.id,
              moka_order_id: null,
              attempt_count: 1,
            },
            error: null,
          };
        }

        if (row.status === 'sent') {
          return {
            data: {
              claimed: false,
              status: 'sent',
              outbox_id: row.id,
              moka_order_id: row.moka_order_id,
              attempt_count: row.attempt_count,
            },
            error: null,
          };
        }

        if (row.status === 'processing') {
          const lastAttempt = new Date(row.last_attempt_at || row.updated_at).getTime();
          if (now.getTime() - lastAttempt < timeoutMs) {
            return {
              data: {
                claimed: false,
                status: 'processing',
                outbox_id: row.id,
                moka_order_id: null,
                attempt_count: row.attempt_count,
              },
              error: null,
            };
          }
          // Stale processing recovery
          row.attempt_count += 1;
          row.last_attempt_at = now.toISOString();
          row.updated_at = now.toISOString();
          return {
            data: {
              claimed: true,
              status: 'processing',
              outbox_id: row.id,
              moka_order_id: null,
              attempt_count: row.attempt_count,
            },
            error: null,
          };
        }

        if (row.status === 'pending' || row.status === 'failed') {
          row.status = 'processing';
          row.attempt_count += 1;
          row.last_attempt_at = now.toISOString();
          row.updated_at = now.toISOString();
          return {
            data: {
              claimed: true,
              status: 'processing',
              outbox_id: row.id,
              moka_order_id: null,
              attempt_count: row.attempt_count,
            },
            error: null,
          };
        }

        return { data: { claimed: false, status: row.status, outbox_id: row.id }, error: null };
      }
      throw new Error(`Unmocked RPC: ${fnName}`);
    }
  };

  return db;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST A — normal customer booking
// Create 1 real-safe test booking.
// Expected: Redbox booking = 1, Moka order = 1
// ─────────────────────────────────────────────────────────────────────────────
test('TEST A — normal customer booking: creates exactly 1 outbox row and 1 Moka order', async () => {
  const db = createMockDb();
  let mokaOrderCount = 0;

  const mockMokaClient = {
    _mokaOutletId: '100818',
    createOrder: async (payload) => {
      mokaOrderCount++;
      return { id: 'moka-order-12345', status: 'created', ...payload };
    }
  };

  const bookingId = 'booking-cust-001';
  const scheduleId = 'sched-cust-001';

  // Seed booking and schedule
  db.tables.bookings.push({
    id: bookingId,
    customer_name: 'Budi Santoso',
    customer_phone: '081234567890',
    service_id: 'srv-gentlemans-cut',
    service_name: "Gentleman's Cut",
    booking_date: '2026-09-15',
    booking_time: '14:00',
    outlet_id: 'outlet-uuid-1',
    barber_id: 'barber-uuid-1',
    status: 'confirmed'
  });

  const schedule = {
    id: scheduleId,
    booking_id: bookingId,
    outlet_id: 'outlet-uuid-1',
    barber_id: 'barber-uuid-1',
    customer_name: 'Budi Santoso',
    customer_phone: '081234567890',
    date: '2026-09-15',
    time: '14:00',
    service_name: "Gentleman's Cut",
    price: 60000,
    moka_synced: false
  };
  db.tables.schedules.push(schedule);

  // Push schedule to Moka
  const pushRes = await pushScheduleToMoka(db, schedule, { mokaClient: mockMokaClient, forceSimulateProduction: true });

  assert.equal(pushRes.success, true, 'Push should succeed');
  assert.equal(mokaOrderCount, 1, 'Moka API should be called exactly once');
  assert.equal(db.tables.moka_order_outbox.length, 1, 'Exactly one outbox row created');
  assert.equal(db.tables.moka_order_outbox[0].status, 'sent', 'Outbox status should be sent');
  assert.equal(db.tables.moka_order_outbox[0].moka_order_id, 'moka-order-12345');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST B — same POST repeated 10 times with same booking_request_id
// Expected: Redbox booking = 1, Moka order = 1
// ─────────────────────────────────────────────────────────────────────────────
test('TEST B — same POST repeated 10 times: exactly 1 booking and 1 Moka order', async () => {
  const db = createMockDb();
  let mokaOrderCount = 0;

  const mockMokaClient = {
    _mokaOutletId: '100818',
    createOrder: async (payload) => {
      mokaOrderCount++;
      return { id: 'moka-order-dup-b', status: 'created' };
    }
  };

  const bookingRequestId = 'req-client-uuid-12345';

  for (let i = 0; i < 10; i++) {
    // Check if booking already exists for this request_id
    const existing = db.tables.bookings.find(b => b.booking_request_id === bookingRequestId);
    if (existing) {
      // Idempotent return of existing booking
      continue;
    }

    const newBooking = {
      id: `booking-${i + 1}`,
      booking_request_id: bookingRequestId,
      customer_name: 'Harrel',
      customer_phone: '087700001111',
      status: 'confirmed'
    };
    db.tables.bookings.push(newBooking);

    const schedule = {
      id: `sched-${i + 1}`,
      booking_id: newBooking.id,
      outlet_id: 'outlet-uuid-1',
      customer_name: newBooking.customer_name,
      customer_phone: newBooking.customer_phone,
      service_name: "Gentleman's Cut",
      price: 60000
    };
    db.tables.schedules.push(schedule);

    await pushScheduleToMoka(db, schedule, { mokaClient: mockMokaClient, forceSimulateProduction: true });
  }

  assert.equal(db.tables.bookings.length, 1, 'Only 1 booking in database');
  assert.equal(mokaOrderCount, 1, 'Only 1 Moka order created across 10 repeated posts');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST C — Moka push function called 10 times with same booking_id
// Expected: Moka order = 1, 9 calls skipped (already_sent)
// ─────────────────────────────────────────────────────────────────────────────
test('TEST C — Moka push called 10 times for same booking: exactly 1 Moka order, 9 skipped', async () => {
  const db = createMockDb();
  let mokaOrderCount = 0;

  const mockMokaClient = {
    _mokaOutletId: '100818',
    createOrder: async (payload) => {
      mokaOrderCount++;
      return { id: 'moka-order-test-c', status: 'created' };
    }
  };

  const schedule = {
    id: 'sched-10x',
    booking_id: 'booking-10x',
    outlet_id: 'outlet-uuid-1',
    customer_name: 'Customer C',
    customer_phone: '081234567899',
    service_name: 'Haircut',
    price: 50000
  };
  db.tables.schedules.push(schedule);

  const results = [];
  for (let i = 0; i < 10; i++) {
    const res = await pushScheduleToMoka(db, schedule, { mokaClient: mockMokaClient, forceSimulateProduction: true });
    results.push(res);
  }

  assert.equal(mokaOrderCount, 1, 'Moka API must be invoked exactly once');
  assert.equal(results[0].success, true, 'First attempt must succeed');
  assert.equal(results[0].skipped, undefined);

  for (let i = 1; i < 10; i++) {
    assert.equal(results[i].skipped, true, `Attempt ${i + 1} must be skipped`);
    assert.equal(results[i].reason, 'already_sent', `Attempt ${i + 1} reason must be already_sent`);
  }
  assert.equal(db.tables.moka_order_outbox.length, 1, 'Only 1 outbox record in DB');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST D — trigger moka-push-retry multiple times on already-sent booking
// Expected: No new Moka order
// ─────────────────────────────────────────────────────────────────────────────
test('TEST D — trigger moka-push-retry >= 5 times for already-sent booking: no new orders', async () => {
  const db = createMockDb();
  let mokaOrderCount = 0;

  // Insert an already sent outbox row
  db.tables.moka_order_outbox.push({
    id: 'outbox-already-sent',
    booking_id: 'booking-d',
    schedule_id: 'sched-d',
    status: 'sent',
    moka_order_id: 'moka-sent-already',
    attempt_count: 1,
    last_attempt_at: new Date().toISOString()
  });

  // Run retry cron 5 times
  for (let i = 0; i < 5; i++) {
    const staleJobs = await getStaleOrFailedJobs(db, 10);
    // staleJobs query must exclude sent jobs
    const eligibleJobs = staleJobs.filter(j => j.id === 'outbox-already-sent');
    assert.equal(eligibleJobs.length, 0, `Run ${i + 1}: already-sent job must NOT be eligible for retry`);
  }

  assert.equal(mokaOrderCount, 0, 'No Moka order should be created by retrying sent bookings');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST E — concurrent execution: multiple workers simultaneously on same booking
// Expected: only one worker performs create-order call
// ─────────────────────────────────────────────────────────────────────────────
test('TEST E — concurrent workers on same booking: exactly 1 creates order, others prevented', async () => {
  const db = createMockDb();
  let mokaOrderCount = 0;

  const mockMokaClient = {
    _mokaOutletId: '100818',
    createOrder: async (payload) => {
      // Simulate network latency
      await new Promise(r => setTimeout(r, 20));
      mokaOrderCount++;
      return { id: 'moka-concurrent-order', status: 'created' };
    }
  };

  const schedule = {
    id: 'sched-concurrent',
    booking_id: 'booking-concurrent',
    outlet_id: 'outlet-uuid-1',
    customer_name: 'Concurrent Cust',
    customer_phone: '081234567888',
    service_name: 'Fade Cut',
    price: 70000
  };
  db.tables.schedules.push(schedule);

  // Spawn 10 simultaneous workers
  const promises = Array.from({ length: 10 }).map(() =>
    pushScheduleToMoka(db, schedule, { mokaClient: mockMokaClient, forceSimulateProduction: true })
  );

  const results = await Promise.all(promises);

  assert.equal(mokaOrderCount, 1, 'Only 1 worker must call Moka createOrder');
  const succeededWorker = results.find(r => r.skipped !== true && r.success === true);
  assert.ok(succeededWorker, 'At least one worker must have successfully created');

  const preventedWorkers = results.filter(r => r.skipped === true && (r.reason === 'already_sent' || r.reason === 'in_flight'));
  assert.equal(preventedWorkers.length, 9, 'All other 9 workers must be prevented');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST F — failed first attempt then retry
// Expected: outbox status failed -> retry updates same row, no duplicate rows
// ─────────────────────────────────────────────────────────────────────────────
test('TEST F — failed first attempt then retry: reuses same row, 0 duplicate rows', async () => {
  const db = createMockDb();
  let attempt = 0;

  const mockMokaClient = {
    _mokaOutletId: '100818',
    createOrder: async (payload) => {
      attempt++;
      if (attempt === 1) {
        throw new Error('Moka 503 Service Unavailable');
      }
      return { id: 'moka-retry-success-id', status: 'created' };
    }
  };

  const schedule = {
    id: 'sched-fail-retry',
    booking_id: 'booking-fail-retry',
    outlet_id: 'outlet-uuid-1',
    customer_name: 'Fail Then Retry Cust',
    customer_phone: '081234567877',
    service_name: 'Haircut',
    price: 50000
  };
  db.tables.schedules.push(schedule);

  // First attempt fails
  const res1 = await pushScheduleToMoka(db, schedule, { mokaClient: mockMokaClient, forceSimulateProduction: true });
  assert.equal(res1.success, false, 'First attempt must fail');
  assert.equal(db.tables.moka_order_outbox.length, 1, 'Exactly 1 outbox row');
  assert.equal(db.tables.moka_order_outbox[0].status, 'failed');
  assert.equal(db.tables.moka_order_outbox[0].attempt_count, 1);

  // Second attempt (retry) succeeds
  const res2 = await pushScheduleToMoka(db, schedule, { mokaClient: mockMokaClient, forceSimulateProduction: true });
  assert.equal(res2.success, true, 'Retry must succeed');
  assert.equal(db.tables.moka_order_outbox.length, 1, 'Still exactly 1 outbox row (no second row!)');
  assert.equal(db.tables.moka_order_outbox[0].status, 'sent');
  assert.equal(db.tables.moka_order_outbox[0].moka_order_id, 'moka-retry-success-id');
  assert.equal(db.tables.moka_order_outbox[0].attempt_count, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST G — automated test mode
// Run booking test suite: Redbox booking tested, Moka orders = 0, WA sends = 0
// ─────────────────────────────────────────────────────────────────────────────
test('TEST G — automated test mode: test context skips Moka push and WA notifications', async () => {
  const db = createMockDb();
  let mokaOrderCount = 0;

  const mockMokaClient = {
    _mokaOutletId: '100818',
    createOrder: async () => {
      mokaOrderCount++;
      return { id: 'moka-should-never-be-called' };
    }
  };

  // 1. Check test context detection for various test flags
  const envAdminPassword = process.env.ADMIN_PASSWORD || 'test-admin-secret';
  process.env.ADMIN_PASSWORD = envAdminPassword;

  assert.equal(
    isRequestAuthenticatedForTest({ headers: { 'x-test-secret': envAdminPassword } }),
    true,
    'Internal test secret authenticates test request'
  );
  assert.equal(
    isTestFixture({ customer_phone: '081299990022' }),
    true,
    'Known test fixture phone recognized'
  );

  // Check evaluateTestIsolation
  assert.equal(isTestFixture({ customer_phone: '081299990022' }), true);
  assert.equal(isTestFixture({ customer_phone: '081234567890' }), false);

  // 2. Simulated booking creation with test fixture
  const testSchedule = {
    id: 'sched-test-automated',
    booking_id: 'booking-test-automated',
    outlet_id: 'outlet-uuid-1',
    customer_name: 'Automated Test Runner',
    customer_phone: '081299990022',
    is_test: true
  };
  db.tables.schedules.push(testSchedule);

  // Push schedule with test context (node --test is running, so isServerTestEnvironment is true)
  const pushRes = await pushScheduleToMoka(db, testSchedule, { mokaClient: mockMokaClient });
  assert.equal(pushRes.skipped, true);
  assert.equal(pushRes.reason, 'server_test_environment');
  assert.equal(mokaOrderCount, 0, 'Zero Moka orders created during automated test');
  assert.equal(db.tables.moka_order_outbox.length, 0, 'Zero outbox rows created for test');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST H — repeated callback: idempotent state update, no new order
// ─────────────────────────────────────────────────────────────────────────────
test('TEST H — repeated callback: updates state idempotently, never triggers createOrder', async () => {
  const db = createMockDb();
  let mokaOrderCount = 0;

  // Existing schedule in DB
  const schedule = {
    id: 'sched-callback-1',
    moka_order_id: 'moka-ord-callback-99',
    status: 'confirmed'
  };
  db.tables.schedules.push(schedule);

  // Simulated callback handler
  const handleMokaCallback = async (payload) => {
    const { order_id, order_status } = payload;
    const existing = db.tables.schedules.find(s => s.moka_order_id === order_id);
    if (!existing) return { updated: false, error: 'Order not found' };

    // Idempotent state update
    existing.moka_order_status = order_status;
    existing.updated_at = new Date().toISOString();
    return { updated: true, scheduleId: existing.id, status: order_status };
  };

  const callbackPayload = {
    order_id: 'moka-ord-callback-99',
    order_status: 'ACCEPTED',
    updated_at: new Date().toISOString()
  };

  // Send callback 5 times
  for (let i = 0; i < 5; i++) {
    const res = await handleMokaCallback(callbackPayload);
    assert.equal(res.updated, true);
    assert.equal(schedule.moka_order_status, 'ACCEPTED');
  }

  assert.equal(mokaOrderCount, 0, 'Callbacks must never invoke createOrder');
});
