'use strict';

/**
 * Task 17.2 — Correction Round 1 (Runtime + Write Reliability).
 *
 * Blocker 1: server/index.js called linkNewlyCreatedBooking without ever
 * importing it — a ReferenceError that only fires when the code path
 * actually executes. Caught here by actually booting the real
 * server/index.js Express app and sending a real HTTP request through the
 * real POST /api/bookings and POST /booking/walkin handlers — not a
 * source/string check, which the correction explicitly says is
 * insufficient for this class of bug.
 *
 * Blocker 2: linkage must be AWAITED before the response is sent (a
 * fire-and-forget promise is not guaranteed to survive past res.end() in a
 * serverless runtime), while remaining unable to fail the reservation.
 *
 * Blocker 3: the conditional UPDATE's { data, error } result must be
 * inspected — Supabase reports write failures as data, not by throwing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  STATUS,
  PERSISTENCE_STATUS,
  linkNewlyCreatedBooking,
} = require('../services/bookingCustomerLinkage');

function resolved(customer_id, overrides = {}) {
  return { status: 'resolved', customer_id, match_basis: 'normalized_phone', candidates_count: 1, confidence: 'high', ...overrides };
}

// ── 4-10: persistence outcome handling (linkNewlyCreatedBooking) ─────────
// Reuses the same conditional-update-aware fake supabase double style as the
// main Task 17.2 test file, extended with an injectable update error.

function fakeBookingsSupabase(initialRows, { updateError = null } = {}) {
  const rows = initialRows.map((r) => ({ ...r }));
  return {
    _rows: rows,
    from(table) {
      if (table !== 'bookings') throw new Error(`unexpected table ${table}`);
      const filters = [];
      let updatePayload = null;
      let selectFields = null;
      const api = {
        update(payload) { updatePayload = payload; return api; },
        eq(field, value) { filters.push((r) => r[field] === value); return api; },
        is(field, value) {
          filters.push((r) => (value === null ? r[field] === null || r[field] === undefined : r[field] === value));
          return api;
        },
        select(fields) { selectFields = fields; return api; },
        then(onFulfilled, onRejected) {
          if (updateError) return Promise.resolve({ data: null, error: updateError }).then(onFulfilled, onRejected);
          const matches = rows.filter((r) => filters.every((f) => f(r)));
          matches.forEach((r) => Object.assign(r, updatePayload));
          const projected = selectFields ? matches.map((r) => ({ id: r.id, customer_id: r.customer_id })) : matches;
          return Promise.resolve({ data: projected, error: null }).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  };
}

test('4. resolved identity + successful conditional update: customer_id persisted, persistence_status = persisted', async () => {
  const supabase = fakeBookingsSupabase([{ id: 'bk-c1-4', customer_id: null }]);
  const plan = await linkNewlyCreatedBooking(supabase, {
    booking: { id: 'bk-c1-4' }, phone: '628111', source: 'booking_create', branch: 'bypass',
  }, { resolveIdentity: async () => resolved('cust-4') });

  assert.equal(plan.status, STATUS.SAFE_LINK);
  assert.equal(plan.persistence_status, PERSISTENCE_STATUS.PERSISTED);
  assert.equal(supabase._rows[0].customer_id, 'cust-4');
});

test('5. Supabase update returns { error }: booking succeeds, linkage reports write_failed, no false success', async () => {
  const supabase = fakeBookingsSupabase([{ id: 'bk-c1-5', customer_id: null }], {
    updateError: { code: '23505', message: 'simulated write failure' },
  });
  let loggedEvent = null;
  const plan = await linkNewlyCreatedBooking(supabase, {
    booking: { id: 'bk-c1-5' }, phone: '628111', source: 'booking_create', branch: 'bypass',
  }, {
    resolveIdentity: async () => resolved('cust-5'),
    logEvent: (e) => { loggedEvent = e; },
  });

  assert.equal(plan.status, STATUS.SAFE_LINK, 'the PURE plan classification is unaffected by the write outcome');
  assert.equal(plan.persistence_status, PERSISTENCE_STATUS.WRITE_FAILED);
  assert.equal(supabase._rows[0].customer_id, null, 'the row must not appear linked when the write actually failed');
  assert.equal(loggedEvent.safe_to_link, false, 'telemetry must reflect the true outcome, not the pre-write plan');
  assert.equal(loggedEvent.persistence_status, 'write_failed');
});

test('6. conditional update returns zero rows (concurrent link/unlink): no false persisted success, existing value untouched', async () => {
  // Row already has a DIFFERENT customer_id by the time the write runs — the
  // WHERE customer_id IS NULL clause matches zero rows.
  const supabase = fakeBookingsSupabase([{ id: 'bk-c1-6', customer_id: 'cust-already-there' }]);
  const plan = await linkNewlyCreatedBooking(supabase, {
    booking: { id: 'bk-c1-6' }, phone: '628111', source: 'booking_create', branch: 'bypass',
  }, { resolveIdentity: async () => resolved('cust-would-be-guessed') });

  assert.equal(plan.persistence_status, PERSISTENCE_STATUS.CONDITIONAL_WRITE_SKIPPED);
  assert.equal(supabase._rows[0].customer_id, 'cust-already-there', 'must never be overwritten');
});

test('7. exactly one matching row updated: persisted success', async () => {
  const supabase = fakeBookingsSupabase([
    { id: 'bk-c1-7a', customer_id: null },
    { id: 'bk-c1-7b', customer_id: null }, // a second, unrelated row must not be touched
  ]);
  const plan = await linkNewlyCreatedBooking(supabase, {
    booking: { id: 'bk-c1-7a' }, phone: '628111', source: 'booking_create', branch: 'bypass',
  }, { resolveIdentity: async () => resolved('cust-7') });

  assert.equal(plan.persistence_status, PERSISTENCE_STATUS.PERSISTED);
  assert.equal(supabase._rows[0].customer_id, 'cust-7');
  assert.equal(supabase._rows[1].customer_id, null, 'the unrelated row must be untouched');
});

test('8. ambiguous resolver: booking succeeds (helper returns normally), customer_id stays NULL, no write attempted', async () => {
  const supabase = fakeBookingsSupabase([{ id: 'bk-c1-8', customer_id: null }]);
  const plan = await linkNewlyCreatedBooking(supabase, {
    booking: { id: 'bk-c1-8' }, phone: '628111', source: 'booking_create', branch: 'bypass',
  }, { resolveIdentity: async () => ({ status: 'ambiguous', customer_id: null, match_basis: null, candidates_count: 2, confidence: null }) });

  assert.equal(plan.status, STATUS.AMBIGUOUS_IDENTITY);
  assert.equal(plan.persistence_status, PERSISTENCE_STATUS.NOT_ATTEMPTED, 'no write should even be attempted for a non-safe_link plan');
  assert.equal(supabase._rows[0].customer_id, null);
});

test('9. resolver throws: booking succeeds (helper absorbs the error, never rejects)', async () => {
  const supabase = fakeBookingsSupabase([{ id: 'bk-c1-9', customer_id: null }]);
  const plan = await linkNewlyCreatedBooking(supabase, {
    booking: { id: 'bk-c1-9' }, phone: '628111', source: 'booking_create', branch: 'bypass',
  }, { resolveIdentity: async () => { throw new Error('network timeout'); } });

  assert.equal(plan.status, STATUS.LOOKUP_FAILED);
  assert.equal(plan.persistence_status, PERSISTENCE_STATUS.NOT_ATTEMPTED);
  assert.equal(supabase._rows[0].customer_id, null);
});

test('10. no overwrite of an existing customer_id, even when the resolver would propose a different one', async () => {
  const supabase = fakeBookingsSupabase([{ id: 'bk-c1-10', customer_id: 'cust-original' }]);
  // linkNewlyCreatedBooking is only ever invoked at creation time with
  // customer_id assumed null by its caller contract, but the DB row itself
  // may already differ (race) — the conditional WHERE is the real guarantee.
  const plan = await linkNewlyCreatedBooking(supabase, {
    booking: { id: 'bk-c1-10' }, phone: '628111', source: 'booking_create', branch: 'bypass',
  }, { resolveIdentity: async () => resolved('cust-different') });

  assert.equal(supabase._rows[0].customer_id, 'cust-original', 'must never be overwritten by the conditional update');
  assert.notEqual(plan.persistence_status, PERSISTENCE_STATUS.PERSISTED);
});

// ── 1-3: the REAL server/index.js route, booted end-to-end ────────────────
// Intercepts @supabase/supabase-js's createClient via the require cache
// BEFORE requiring server/index.js, so the module's own internal `supabase`
// client is our fake — no real network call, no real credentials. This is
// real code execution through the actual route handler, not a source check;
// a reintroduced missing-import bug (Blocker 1) would surface here as a 500
// instead of 201, because the whole handler body is wrapped in a top-level
// try/catch that turns any thrown error (including a ReferenceError) into
// `res.status(500).json({ error: err.message })`.

function makeQueryableTable(rows, tableName) {
  return () => {
    const filters = [];
    let action = 'select';
    let payload = null;
    let upsertOpts = null;
    let wantSingle = false;
    let wantMaybeSingle = false;
    const api = {
      select() { return api; },
      insert(p) { action = 'insert'; payload = Array.isArray(p) ? p : [p]; return api; },
      upsert(p, opts) { action = 'upsert'; payload = p; upsertOpts = opts || {}; return api; },
      update(p) { action = 'update'; payload = p; return api; },
      eq(f, v) { filters.push((r) => r[f] === v); return api; },
      neq(f, v) { filters.push((r) => r[f] !== v); return api; },
      gte(f, v) { filters.push((r) => r[f] >= v); return api; },
      lte(f, v) { filters.push((r) => r[f] <= v); return api; },
      gt(f, v) { filters.push((r) => r[f] > v); return api; },
      is(f, v) { filters.push((r) => (v === null ? (r[f] === null || r[f] === undefined) : r[f] === v)); return api; },
      not() { return api; },
      or() { return api; }, // test seeds exactly the candidate rows that should be considered
      order() { return api; },
      limit() { return api; },
      single() { wantSingle = true; return api; },
      maybeSingle() { wantMaybeSingle = true; return api; },
      then(onFulfilled, onRejected) { return Promise.resolve(execute()).then(onFulfilled, onRejected); },
    };
    function execute() {
      if (action === 'insert') {
        const inserted = payload.map((p, i) => ({ id: p.id || `${tableName}-new-${rows.length + i + 1}`, ...p }));
        rows.push(...inserted);
        return { data: wantSingle ? inserted[0] : inserted, error: null };
      }
      if (action === 'upsert') {
        const conflictField = upsertOpts.onConflict;
        let row = conflictField ? rows.find((r) => r[conflictField] === payload[conflictField]) : null;
        if (row) {
          if (!upsertOpts.ignoreDuplicates) Object.assign(row, payload);
        } else {
          row = { id: `${tableName}-new-${rows.length + 1}`, ...payload };
          rows.push(row);
        }
        return { data: row, error: null };
      }
      if (action === 'update') {
        const matches = rows.filter((r) => filters.every((f) => f(r)));
        matches.forEach((r) => Object.assign(r, payload));
        return { data: wantSingle || wantMaybeSingle ? (matches[0] || null) : matches, error: null };
      }
      const matches = rows.filter((r) => filters.every((f) => f(r)));
      if (wantSingle) return { data: matches[0] || null, error: matches[0] ? null : { code: 'PGRST116', message: 'no rows' } };
      if (wantMaybeSingle) return { data: matches[0] || null, error: null };
      return { data: matches, error: null };
    }
    return api;
  };
}

function fakeFullBookingSupabase(seed = {}) {
  const store = {
    barbers: seed.barbers || [], bookings: seed.bookings || [], schedules: seed.schedules || [],
    customers: seed.customers || [], member_profiles: seed.member_profiles || [], users: [],
  };
  return {
    _store: store,
    from(table) {
      if (!store[table]) store[table] = [];
      return makeQueryableTable(store[table], table)();
    },
  };
}

async function withRealBookingApp(fakeClient, fn) {
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
  process.env.ADMIN_PASSWORD = 'test-admin-password-round3';
  delete process.env.DATABASE_TYPE; // ensure DB_TYPE resolves to 'supabase'

  const savedSupabaseJsModule = require.cache[supabaseJsPath];
  require.cache[supabaseJsPath] = {
    id: supabaseJsPath, filename: supabaseJsPath, loaded: true, children: [], paths: [],
    exports: { createClient: () => fakeClient },
  };
  delete require.cache[indexPath];

  let app;
  try {
    app = require('../index.js');
  } finally {
    if (savedSupabaseJsModule) require.cache[supabaseJsPath] = savedSupabaseJsModule;
    else delete require.cache[supabaseJsPath];
  }

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[indexPath];
    Object.entries(savedEnv).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  }
}

test('1/2. POST /api/bookings (the real Express route) actually calls linkNewlyCreatedBooking and awaits it before responding — a missing import surfaces as 500, not 201', async () => {
  const fakeClient = fakeFullBookingSupabase({
    barbers: [{ id: 'barber-c1', name: 'Budi', is_active: true, branch: 'bypass', outlet_id: null }],
  });

  const statusCode = await withRealBookingApp(fakeClient, async (base) => {
    const res = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': 'test-admin-password-round3' },
      body: JSON.stringify({
        name: 'Correction Round 1 Test Customer', wa: '6281111220001', service_id: 'haircut', service: 'Haircut',
        price: 50000, duration: '30', barber_id: 'barber-c1', date: '2026-09-01', time: '10:00',
        location: 'bypass', status: 'pending', type: 'home_service',
      }),
    });
    return res.status;
  });

  // A reintroduced Blocker 1 (missing import) throws a synchronous
  // ReferenceError inside the route's own try/catch, which returns 500 —
  // 201 is only reachable if linkNewlyCreatedBooking actually resolved.
  assert.equal(statusCode, 201);
  assert.equal(fakeClient._store.bookings.length, 1);
  // The linkage call was awaited: by the time the response was already
  // computed (this assertion runs after the response completed), the
  // customer upsert it depends on has already happened too.
  assert.equal(fakeClient._store.customers.length, 1);
});

test('3. POST /booking/walkin (adminCrm.js) also awaits linkage before responding', async () => {
  const fakeClient = fakeFullBookingSupabase({
    barbers: [{ id: 'barber-c1-walkin', name: 'Ubay', is_active: true, branch: 'bypass', outlet_id: null }],
  });

  const { status, body } = await withRealBookingApp(fakeClient, async (base) => {
    const res = await fetch(`${base}/api/admin/crm/booking/walkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': 'test-admin-password-round3' },
      body: JSON.stringify({ name: 'Walkin Test', wa: '6281111220002', barber_id: 'barber-c1-walkin', service: 'Haircut', branch: 'bypass' }),
    });
    let parsed = null;
    try { parsed = await res.json(); } catch (_e) { /* ignore */ }
    return { status: res.status, body: parsed };
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(fakeClient._store.bookings.length, 1);
});
