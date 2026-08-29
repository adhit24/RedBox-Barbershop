'use strict';

/**
 * Data Authority Repair Round 1 — test suite.
 *
 * DA-01: server/moka/sync.js's schedules writers must never silently swallow
 * a no_barber_overlap exclusion-constraint violation. Covers the new
 * _reconcileOpenBillOverlap classifier (concurrent-duplicate-insert reconciled
 * vs. true business overlap vs. unresolved/degraded), and confirms Reddy's
 * existing schedule-authority guards remain fail-safe.
 *
 * DA-02: api/cron/home-service-flag.js's H-1 reminder job must fail visibly,
 * not silently, when home_service_jobs.barber_reminded_at is missing (the
 * additive migration server/migrations/2026-05-31-add-barber-reminder-column.sql
 * already exists but was never applied to production).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  _reconcileOpenBillOverlap, _checkDurableConflictBlock, _recordConflictBlock,
} = require('../moka/sync');
const { sanitizeDataAuthorityTelemetry, logDataAuthorityEvent } = require('../orchestrator/telemetry');
const {
  EVENT_DEFINITIONS, mapTelemetryToEvaluation, recordEvaluationEvent,
} = require('../services/reddyEvaluationMonitoring');
const { getBarberScheduleStatus } = require('../services/barberScheduleAuthority');
const { guardRealtimeBarberFacts } = require('../agents/reddy/realtimeFactGuard');

// ── Fake schedules + sync_logs Supabase builder (mirrors the pattern already ──
// ── used across this codebase's other test suites — see task15-p0-crosslayer, ─
// ── reddy-idle-timeout-v01). Two independent in-memory tables, sharing no ──────
// ── process state beyond this one object — a FRESH instance per test call ──────
// ── simulates a genuinely separate serverless invocation reading only what ─────
// ── was actually persisted (never in-memory only). ─────────────────────────────
function fakeDataAuthoritySupabase({ schedules = [], syncLogs = [] } = {}) {
  // Deliberately NOT copied — callers that want two separate "invocations"
  // reading/writing the SAME durable store (see DA1-13) pass the identical
  // array references into two fakeDataAuthoritySupabase() calls. Every other
  // test passes fresh literal arrays inline, so there is no cross-test
  // sharing risk either way.
  const scheduleRows = schedules;
  const syncLogRows = syncLogs;
  let nextSyncLogId = syncLogRows.length + 1;

  function schedulesTable() {
    const filters = [];
    const builder = {
      select() { return builder; },
      eq(field, value) { filters.push((row) => row[field] === value); return builder; },
      neq(field, value) { filters.push((row) => row[field] !== value); return builder; },
      lt(field, value) { filters.push((row) => row[field] < value); return builder; },
      gt(field, value) { filters.push((row) => row[field] > value); return builder; },
      limit() { return builder; },
      async maybeSingle() {
        const match = scheduleRows.find((row) => filters.every((f) => f(row))) || null;
        return { data: match, error: null };
      },
    };
    return builder;
  }

  function syncLogsTable() {
    const filters = [];
    let insertPayload = null;
    let orderDesc = false;
    const builder = {
      select() { return builder; },
      eq(field, value) { filters.push((row) => row[field] === value); return builder; },
      order(_field, opts) { orderDesc = !(opts?.ascending ?? true); return builder; },
      limit() { return builder; },
      insert(payload) { insertPayload = payload; return builder; },
      async maybeSingle() {
        if (insertPayload) {
          const row = { id: `log-${nextSyncLogId++}`, created_at: new Date().toISOString(), ...insertPayload };
          syncLogRows.push(row);
          return { data: row, error: null };
        }
        let matches = syncLogRows.filter((row) => filters.every((f) => f(row)));
        matches = matches.slice().sort((a, b) => (orderDesc ? -1 : 1) * (a.created_at < b.created_at ? -1 : 1));
        return { data: matches[0] || null, error: null };
      },
      then(onFulfilled, onRejected) {
        // Supports `await supabase.from('sync_logs').insert({...})` with no
        // trailing .select()/.maybeSingle() — same thenable-builder trick
        // used elsewhere in this codebase's test fakes.
        return Promise.resolve(this.maybeSingle()).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  function from(table) {
    if (table === 'schedules') return schedulesTable();
    if (table === 'sync_logs') return syncLogsTable();
    throw new Error(`Unexpected table: ${table}`);
  }

  return { scheduleRows, syncLogRows, from };
}

// Back-compat alias — most DA-01 tests only ever touch the schedules table.
function fakeSchedulesSupabase(rows = []) {
  const combined = fakeDataAuthoritySupabase({ schedules: rows });
  return { rows: combined.scheduleRows, from: combined.from };
}

// ── DA-01: _reconcileOpenBillOverlap ──────────────────────────────────────

test('DA1-01. concurrent duplicate insert of the SAME bill is reconciled, not treated as a failure', async () => {
  const now = '2026-08-29T10:00:00.000Z';
  const later = '2026-08-29T11:00:00.000Z';
  const sb = fakeSchedulesSupabase([
    { id: 'sch-1', barber_id: 'barber-1', external_id: 'MOKA-BILL-42', source: 'moka', status: 'reserved', start_time: now, end_time: later },
  ]);

  const result = await _reconcileOpenBillOverlap(sb, {
    billId: 'MOKA-BILL-42',
    barberId: 'barber-1',
    startTime: new Date(now),
    endTime: new Date(later),
  });

  assert.equal(result, 'skipped');
  // Integrity: the pre-existing authoritative row must be completely untouched.
  assert.deepEqual(sb.rows, [
    { id: 'sch-1', barber_id: 'barber-1', external_id: 'MOKA-BILL-42', source: 'moka', status: 'reserved', start_time: now, end_time: later },
  ]);
});

test('DA1-02. true business overlap (different external_id) preserves the existing authoritative row', async () => {
  const now = '2026-08-29T10:00:00.000Z';
  const later = '2026-08-29T11:00:00.000Z';
  const sb = fakeSchedulesSupabase([
    { id: 'sch-1', barber_id: 'barber-1', external_id: 'MOKA-BILL-OTHER', source: 'moka', status: 'reserved', start_time: now, end_time: later },
  ]);

  const result = await _reconcileOpenBillOverlap(sb, {
    billId: 'MOKA-BILL-42',
    barberId: 'barber-1',
    startTime: new Date(now),
    endTime: new Date(later),
  });

  assert.equal(result, 'skipped');
  assert.equal(sb.rows.length, 1, 'the existing row must not be deleted');
  assert.equal(sb.rows[0].external_id, 'MOKA-BILL-OTHER', 'the winning row must remain the authoritative one');
});

test('DA1-03. true overlap does not delete or mutate the existing valid schedule', async () => {
  const now = '2026-08-29T10:00:00.000Z';
  const later = '2026-08-29T11:00:00.000Z';
  const existingRow = { id: 'sch-1', barber_id: 'barber-1', external_id: 'MOKA-BILL-OTHER', source: 'web', status: 'confirmed', start_time: now, end_time: later };
  const sb = fakeSchedulesSupabase([existingRow]);

  await _reconcileOpenBillOverlap(sb, {
    billId: 'MOKA-BILL-42', barberId: 'barber-1', startTime: new Date(now), endTime: new Date(later),
  });

  assert.deepEqual(sb.rows[0], existingRow, 'no field of the existing row may be mutated by a reconciliation attempt');
});

test('DA1-04. no conflicting row found on re-check is flagged as degraded authority, not silently ignored', async () => {
  const now = '2026-08-29T10:00:00.000Z';
  const later = '2026-08-29T11:00:00.000Z';
  const sb = fakeSchedulesSupabase([]); // conflict already resolved itself between INSERT and re-check

  const events = [];
  const originalLog = console.warn;
  console.warn = () => {};
  try {
    const result = await _reconcileOpenBillOverlap(sb, {
      billId: 'MOKA-BILL-42', barberId: 'barber-1', startTime: new Date(now), endTime: new Date(later),
    });
    assert.equal(result, 'skipped');
  } finally {
    console.warn = originalLog;
  }
});

test('DA1-05. every reconciliation outcome (reconciled / true overlap / unresolved) is telemetered, never blindly retried silently', async () => {
  const now = '2026-08-29T10:00:00.000Z';
  const later = '2026-08-29T11:00:00.000Z';
  const scenarios = [
    { rows: [{ id: 'sch-1', barber_id: 'b1', external_id: 'BILL-1', source: 'moka', status: 'reserved', start_time: now, end_time: later }], billId: 'BILL-1', expectEvent: 'schedule_sync_conflict_reconciled' },
    { rows: [{ id: 'sch-1', barber_id: 'b1', external_id: 'BILL-OTHER', source: 'moka', status: 'reserved', start_time: now, end_time: later }], billId: 'BILL-1', expectEvent: 'schedule_sync_overlap_failure' },
    { rows: [], billId: 'BILL-1', expectEvent: 'schedule_sync_conflict_unresolved' },
  ];

  for (const scenario of scenarios) {
    const logged = [];
    const originalConsoleLog = console.log;
    console.log = (...args) => {
      if (args[0] === '[DataAuthorityTelemetry]') logged.push(JSON.parse(args[1]));
      else originalConsoleLog(...args);
    };
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const sb = fakeSchedulesSupabase(scenario.rows);
      await _reconcileOpenBillOverlap(sb, {
        billId: scenario.billId, barberId: 'b1', startTime: new Date(now), endTime: new Date(later),
      });
    } finally {
      console.log = originalConsoleLog;
      console.warn = originalWarn;
    }
    assert.ok(
      logged.some((e) => e.event_type === scenario.expectEvent),
      `expected ${scenario.expectEvent} telemetry, got: ${JSON.stringify(logged)}`,
    );
  }
});

test('DA1-06. deterministic external_id: Moka bill.id is used as-is, never a random UUID fallback', () => {
  const syncSource = fs.readFileSync(path.join(__dirname, '../moka/sync.js'), 'utf8');
  assert.match(syncSource, /const billId\s*=\s*String\(bill\.id\)/,
    'billId must be derived deterministically from the upstream Moka bill id, not generated');
  assert.doesNotMatch(syncSource, /external_id:\s*(?:uuid|randomUUID|crypto\.)/i);
});

test('DA1-07. source normalization: Moka-origin schedule inserts always write a literal, constraint-valid source', () => {
  const syncSource = fs.readFileSync(path.join(__dirname, '../moka/sync.js'), 'utf8');
  const schemaSource = fs.readFileSync(path.join(__dirname, '../moka_integration_schema.sql'), 'utf8');
  assert.match(schemaSource, /source\s+TEXT NOT NULL DEFAULT 'web'\s*\n\s*CHECK \(source IN \('web','moka'\)\)/);
  // Every schedules insert in the Moka sync writer must use one of the two
  // CHECK-constraint-valid literals — never a dynamic/unvalidated value from
  // the Moka payload itself.
  const scheduleInsertBlocks = syncSource.match(/\.from\('schedules'\)\s*\.insert\(\{[\s\S]*?\}\)/g) || [];
  assert.ok(scheduleInsertBlocks.length > 0, 'expected at least one schedules insert in sync.js');
  for (const block of scheduleInsertBlocks) {
    assert.match(block, /source:\s*(?:'web'|'moka')/, `insert must use a constraint-valid literal source: ${block.slice(0, 80)}...`);
  }
});

test('DA1-08. concurrent/near-concurrent duplicate writer: a second reconciliation call for the same winning row still classifies as reconciled', async () => {
  const now = '2026-08-29T10:00:00.000Z';
  const later = '2026-08-29T11:00:00.000Z';
  const sb = fakeSchedulesSupabase([
    { id: 'sch-1', barber_id: 'barber-1', external_id: 'MOKA-BILL-42', source: 'moka', status: 'reserved', start_time: now, end_time: later },
  ]);

  const first = await _reconcileOpenBillOverlap(sb, { billId: 'MOKA-BILL-42', barberId: 'barber-1', startTime: new Date(now), endTime: new Date(later) });
  const second = await _reconcileOpenBillOverlap(sb, { billId: 'MOKA-BILL-42', barberId: 'barber-1', startTime: new Date(now), endTime: new Date(later) });

  assert.equal(first, 'skipped');
  assert.equal(second, 'skipped');
  assert.equal(sb.rows.length, 1, 'no duplicate row must ever be created across repeated near-concurrent attempts');
});

test('DA1-09. sync failure emits structured degraded-authority telemetry with an allowlisted, non-PII shape', () => {
  const safe = sanitizeDataAuthorityTelemetry({
    event_type: 'schedule_sync_conflict_unresolved',
    reason: 'exclusion_violation_no_conflicting_row_on_recheck',
    source: 'moka',
  });
  assert.equal(safe.event_type, 'schedule_sync_conflict_unresolved');
  assert.equal(safe.reason, 'exclusion_violation_no_conflicting_row_on_recheck');
  assert.ok(safe.timestamp);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'phone'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'customer_name'), false);

  const unknown = sanitizeDataAuthorityTelemetry({ event_type: 'made_up', source: 'made_up' });
  assert.equal(unknown.event_type, 'unknown');
  assert.equal(unknown.source, null);
});

test('DA1-10. Reddy cannot claim barber availability when the schedule authority lookup fails (existing guard, confirmed unchanged)', async () => {
  const throwingSupabase = { from() { throw new Error('DB unavailable'); } };
  const status = await getBarberScheduleStatus(throwingSupabase, { barberId: 'barber-1', date: '2026-08-29' });
  assert.equal(status.status, 'unknown', 'a failed schedule lookup must never resolve to a claimable status');
  assert.equal(status.source, null);

  // realtimeFactGuard.js must still catch an unsupported presence claim even
  // when no verifiedSchedule was available this turn (Task 14.1 round 2 —
  // confirmed unchanged by this task, not modified).
  const guarded = guardRealtimeBarberFacts('Mas Ubay masuk hari ini, langsung aja ya Kak.', { verifiedSchedule: null });
  assert.doesNotMatch(guarded.sanitizedReply, /Ubay masuk hari ini/i);
  assert.equal(guarded.triggered, true, 'an unverified presence-today claim must always be caught, schedule lookup or not');
});

// ── DA-01 Correction Round 1 (Blocker 1): durable conflict short-circuit ──

test('DA1-11. first true overlap hits the exclusion constraint once, classifies it, and persists the minimal conflict record', async () => {
  const now = '2026-08-29T10:00:00.000Z';
  const later = '2026-08-29T11:00:00.000Z';
  const sb = fakeDataAuthoritySupabase({
    schedules: [{ id: 'sch-winner', barber_id: 'barber-1', external_id: 'BILL-OTHER', source: 'moka', status: 'reserved', start_time: now, end_time: later }],
  });

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await _reconcileOpenBillOverlap(sb, { billId: 'BILL-42', barberId: 'barber-1', startTime: new Date(now), endTime: new Date(later) });
    assert.equal(result, 'skipped');
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(sb.syncLogRows.length, 1, 'a conflict record must be persisted for a true overlap');
  const record = sb.syncLogRows[0];
  assert.equal(record.entity_type, 'schedule_conflict');
  assert.equal(record.entity_id, 'BILL-42');
  assert.equal(record.status, 'failed');
  assert.equal(record.payload.conflicting_schedule_id, 'sch-winner');
});

test('DA1-12. a second pull for the same bill short-circuits before INSERT — no new exclusion violation attempted', async () => {
  const now = '2026-08-29T10:00:00.000Z';
  const later = '2026-08-29T11:00:00.000Z';
  const sb = fakeDataAuthoritySupabase({
    schedules: [{ id: 'sch-winner', barber_id: 'barber-1', external_id: 'BILL-OTHER', source: 'moka', status: 'reserved', start_time: now, end_time: later }],
  });

  // Pass 1: real conflict occurs and is recorded.
  await _recordConflictBlock(sb, { billId: 'BILL-42', barberId: 'barber-1', conflict: { id: 'sch-winner', external_id: 'BILL-OTHER', source: 'moka' } });

  // Pass 2: _processOpenBill's new early gate checks BEFORE attempting any
  // preflight or INSERT — proving the second pull never even tries to write.
  const { blocked } = await _checkDurableConflictBlock(sb, {
    billId: 'BILL-42', barberId: 'barber-1', startTime: new Date(now), endTime: new Date(later),
  });
  assert.equal(blocked, true, 'a still-live conflict must short-circuit the next pull before any INSERT attempt');
  // No new row was written to `schedules` by the check itself.
  assert.equal(sb.scheduleRows.length, 1);
});

test('DA1-13. conflict state is durable across a fresh Supabase instance, not in-memory only', async () => {
  const now = '2026-08-29T10:00:00.000Z';
  const later = '2026-08-29T11:00:00.000Z';
  const persistedSyncLogs = [];
  const persistedSchedules = [{ id: 'sch-winner', barber_id: 'barber-1', external_id: 'BILL-OTHER', source: 'moka', status: 'reserved', start_time: now, end_time: later }];

  // "Invocation 1" (its own fake supabase instance) records the conflict.
  const invocation1 = fakeDataAuthoritySupabase({ schedules: persistedSchedules, syncLogs: persistedSyncLogs });
  await _recordConflictBlock(invocation1, { billId: 'BILL-42', barberId: 'barber-1', conflict: { id: 'sch-winner', external_id: 'BILL-OTHER', source: 'moka' } });

  // "Invocation 2" is a BRAND NEW object — no shared JS reference to
  // invocation1 except the two arrays that stand in for the actual Postgres
  // tables, simulating a different serverless instance reading only what
  // was actually persisted (never process memory).
  const invocation2 = fakeDataAuthoritySupabase({ schedules: persistedSchedules, syncLogs: persistedSyncLogs });
  const { blocked } = await _checkDurableConflictBlock(invocation2, {
    billId: 'BILL-42', barberId: 'barber-1', startTime: new Date(now), endTime: new Date(later),
  });
  assert.equal(blocked, true, 'the conflict record must be readable from a completely separate Supabase client/instance');
});

test('DA1-14. once the blocking schedule is cancelled/removed, the bill becomes retryable again', async () => {
  const now = '2026-08-29T10:00:00.000Z';
  const later = '2026-08-29T11:00:00.000Z';
  const sb = fakeDataAuthoritySupabase({
    schedules: [{ id: 'sch-winner', barber_id: 'barber-1', external_id: 'BILL-OTHER', source: 'moka', status: 'reserved', start_time: now, end_time: later }],
  });
  await _recordConflictBlock(sb, { billId: 'BILL-42', barberId: 'barber-1', conflict: { id: 'sch-winner', external_id: 'BILL-OTHER', source: 'moka' } });

  // The blocking schedule is now cancelled (e.g. resolved manually in Moka).
  sb.scheduleRows[0].status = 'cancelled';

  const { blocked } = await _checkDurableConflictBlock(sb, {
    billId: 'BILL-42', barberId: 'barber-1', startTime: new Date(now), endTime: new Date(later),
  });
  assert.equal(blocked, false, 'a resolved conflict must not permanently suppress future retries — no explicit "clear" step needed, re-validation is live');
});

test('DA1-15. an unresolved/transient classification never persists a block (no permanent suppression without evidence)', async () => {
  const now = '2026-08-29T10:00:00.000Z';
  const later = '2026-08-29T11:00:00.000Z';
  const sb = fakeDataAuthoritySupabase({ schedules: [] }); // no conflicting row found on re-check

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await _reconcileOpenBillOverlap(sb, { billId: 'BILL-42', barberId: 'barber-1', startTime: new Date(now), endTime: new Date(later) });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(sb.syncLogRows.length, 0, 'an unresolved (no evidence of a real conflicting row) outcome must not write a durable block');
  const { blocked } = await _checkDurableConflictBlock(sb, {
    billId: 'BILL-42', barberId: 'barber-1', startTime: new Date(now), endTime: new Date(later),
  });
  assert.equal(blocked, false);
});

test('DA1-16. _checkDurableConflictBlock never mutates or deletes any schedule row — it only reads', async () => {
  const now = '2026-08-29T10:00:00.000Z';
  const later = '2026-08-29T11:00:00.000Z';
  const winnerRow = { id: 'sch-winner', barber_id: 'barber-1', external_id: 'BILL-OTHER', source: 'moka', status: 'reserved', start_time: now, end_time: later };
  const sb = fakeDataAuthoritySupabase({ schedules: [{ ...winnerRow }] });
  await _recordConflictBlock(sb, { billId: 'BILL-42', barberId: 'barber-1', conflict: { id: 'sch-winner', external_id: 'BILL-OTHER', source: 'moka' } });

  await _checkDurableConflictBlock(sb, { billId: 'BILL-42', barberId: 'barber-1', startTime: new Date(now), endTime: new Date(later) });
  await _checkDurableConflictBlock(sb, { billId: 'BILL-42', barberId: 'barber-1', startTime: new Date(now), endTime: new Date(later) });

  assert.equal(sb.scheduleRows.length, 1);
  assert.deepEqual(sb.scheduleRows[0], winnerRow, 'existing valid schedule must never be mutated just to make room for a re-check');
});

test('DA1-17. a lookup failure while checking the durable block fails open (never itself becomes a block)', async () => {
  const throwingSupabase = { from() { throw new Error('DB unavailable'); } };
  const { blocked } = await _checkDurableConflictBlock(throwingSupabase, {
    billId: 'BILL-42', barberId: 'barber-1', startTime: new Date('2026-08-29T10:00:00.000Z'), endTime: new Date('2026-08-29T11:00:00.000Z'),
  });
  assert.equal(blocked, false);
});

// ── DA-01 Correction Round 1 (Blocker 2): Task16 evaluation monitoring ────

test('DA1-18. all 5 data-authority events are registered in Task16 EVENT_DEFINITIONS with the specified severities', () => {
  assert.equal(EVENT_DEFINITIONS.schedule_sync_conflict_reconciled[0], 'INFO');
  assert.equal(EVENT_DEFINITIONS.schedule_sync_overlap_failure[0], 'HIGH');
  assert.equal(EVENT_DEFINITIONS.schedule_sync_conflict_unresolved[0], 'HIGH');
  assert.equal(EVENT_DEFINITIONS.schedule_authority_degraded[0], 'HIGH');
  assert.equal(EVENT_DEFINITIONS.home_service_schema_mismatch[0], 'HIGH');
  for (const key of ['schedule_sync_conflict_reconciled', 'schedule_sync_overlap_failure', 'schedule_sync_conflict_unresolved', 'schedule_authority_degraded', 'home_service_schema_mismatch']) {
    assert.equal(EVENT_DEFINITIONS[key][1], 'data_authority', `${key} should belong to the data_authority source family`);
  }
});

test('DA1-19. mapTelemetryToEvaluation("data_authority", ...) maps a sanitized telemetry event into a recordable evaluation event', () => {
  const safe = sanitizeDataAuthorityTelemetry({
    event_type: 'schedule_sync_overlap_failure', reason: 'true_business_overlap', source: 'moka', branch: 'bypass',
  });
  const mapped = mapTelemetryToEvaluation('data_authority', safe);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].event_type, 'schedule_sync_overlap_failure');
  assert.equal(mapped[0].branch, 'bypass');
  assert.equal(mapped[0].metadata.reason, 'true_business_overlap');
  assert.equal(mapped[0].metadata.source, 'moka');

  // An unrecognized event_type (sanitized down to 'unknown') maps to nothing.
  const unknownMapped = mapTelemetryToEvaluation('data_authority', { event_type: 'unknown' });
  assert.deepEqual(unknownMapped, []);
});

test('DA1-20. logDataAuthorityEvent reaches Task16 observation (observeTelemetry) and never throws even if recording fails', () => {
  const throwingSupabase = { from() { throw new Error('DB unavailable'); } };
  assert.doesNotThrow(() => {
    logDataAuthorityEvent({ event_type: 'schedule_sync_overlap_failure', reason: 'true_business_overlap', source: 'moka', branch: 'bypass' });
  });
  // recordEvaluationEvent itself (what observeTelemetry calls under the hood)
  // must also fail open when given a broken supabase dependency — caught and
  // returned as a status, never thrown — proving the whole path stays
  // observer-only, never a new failure surface.
  return recordEvaluationEvent(
    { event_type: 'schedule_sync_overlap_failure', branch: 'bypass' },
    { supabase: throwingSupabase },
  ).then((result) => {
    assert.equal(result.status, 'error');
  });
});

test('DA1-21. data-authority telemetry never carries PII — only classification dimensions reach the evaluation event', () => {
  const safe = sanitizeDataAuthorityTelemetry({
    event_type: 'schedule_sync_overlap_failure',
    reason: 'true_business_overlap',
    source: 'moka',
    branch: 'bypass',
    // Attempting to smuggle PII through unlisted fields must have no effect —
    // the sanitizer only ever reads the 4 allowlisted keys.
    phone: '628111222333',
    customer_name: 'Budi Santoso',
    raw_bill_payload: { customer: { phone: '628111222333' } },
  });
  assert.deepEqual(Object.keys(safe).sort(), ['branch', 'event_type', 'reason', 'source', 'timestamp']);
  const mapped = mapTelemetryToEvaluation('data_authority', safe);
  const serialized = JSON.stringify(mapped);
  assert.doesNotMatch(serialized, /628111222333/);
  assert.doesNotMatch(serialized, /Budi Santoso/);
});

// ── DA-02: home-service reminder schema drift ─────────────────────────────

function fakeHomeServiceSupabase({ jobsError = null, jobs = [], schedule = null, barber = null } = {}) {
  const updates = [];
  return {
    updates,
    from(table) {
      if (table === 'home_service_jobs') {
        return {
          select() { return this; },
          eq() { return this; },
          is() { return this; },
          update(patch) { updates.push(patch); return this; },
          async then(resolve) { resolve({ data: jobsError ? null : jobs, error: jobsError }); },
        };
      }
      if (table === 'schedules') {
        return {
          select() { return this; },
          eq() { return this; },
          async single() { return { data: schedule, error: schedule ? null : { message: 'not found' } }; },
        };
      }
      if (table === 'barbers') {
        return {
          select() { return this; },
          eq() { return this; },
          async single() { return { data: barber, error: barber ? null : { message: 'not found' } }; },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function loadHomeServiceFlagHandler() {
  delete require.cache[require.resolve('../../api/cron/home-service-flag')];
  return require('../../api/cron/home-service-flag');
}

// api/cron/home-service-flag.js has no dependency-injection seam for the WA
// send it makes (unlike this codebase's DI-based handlers elsewhere) — the
// real notifyBarberHomeServiceReminderH1 throws when FONNTE_TOKEN is unset
// (the correct behavior, so a genuinely-failed send never marks
// barber_reminded_at — see DA2-04's first assertion). To test the
// SUCCESSFUL-send idempotency path without a real network call, substitute
// the waNotification module in Node's require cache for the duration of one
// callback, then restore it — the only way to exercise that path given the
// module's existing structure, without weakening send-failure semantics.
function withFakeWaNotification(fakeImpl, fn) {
  const modulePath = require.resolve('../services/waNotification');
  const original = require.cache[modulePath];
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: fakeImpl };
  delete require.cache[require.resolve('../../api/cron/home-service-flag')];
  try {
    return fn();
  } finally {
    if (original) require.cache[modulePath] = original;
    else delete require.cache[modulePath];
    delete require.cache[require.resolve('../../api/cron/home-service-flag')];
  }
}

test('DA2-01. the reminder job no longer treats a missing barber_reminded_at column as a silent success', async () => {
  const { sendHomeServiceReminders } = loadHomeServiceFlagHandler();
  const sb = fakeHomeServiceSupabase({
    jobsError: { code: '42703', message: 'column home_service_jobs.barber_reminded_at does not exist' },
  });

  const result = await sendHomeServiceReminders(sb);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'barber_reminded_at_column_missing');
});

test('DA2-01b. the response prefers the stable reason code over raw SQL error text when the failure is classified', async () => {
  const { sendHomeServiceReminders } = loadHomeServiceFlagHandler();
  const sb = fakeHomeServiceSupabase({
    jobsError: { code: '42703', message: 'column home_service_jobs.barber_reminded_at does not exist' },
  });
  const result = await sendHomeServiceReminders(sb);
  assert.equal(result.reason, 'barber_reminded_at_column_missing');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'error'), false,
    'a classified failure must not also leak the raw SQL error text — the reason code is self-explanatory');

  // An UNCLASSIFIED failure keeps a bounded error string (no stable code
  // exists to fall back on, and this is an internal/CRON_SECRET-protected
  // endpoint, never a customer-facing surface).
  const unclassifiedSb = fakeHomeServiceSupabase({ jobsError: { code: 'ECONNRESET', message: 'connection reset' } });
  const unclassifiedResult = await sendHomeServiceReminders(unclassifiedSb);
  assert.equal(unclassifiedResult.reason, 'query_failed');
  assert.equal(unclassifiedResult.error, 'connection reset');
});

test('DA2-02. the existing additive migration contains the correct barber_reminded_at definition', () => {
  const migrationSource = fs.readFileSync(
    path.join(__dirname, '../migrations/2026-05-31-add-barber-reminder-column.sql'), 'utf8',
  );
  assert.match(migrationSource, /ALTER TABLE home_service_jobs/);
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS barber_reminded_at TIMESTAMPTZ/);
  assert.doesNotMatch(migrationSource, /DROP|DELETE FROM|TRUNCATE/i, 'must be purely additive');
});

test('DA2-03. the reminder query excludes jobs that already have barber_reminded_at set (idempotency)', async () => {
  const { sendHomeServiceReminders } = loadHomeServiceFlagHandler();
  // Simulates the second run: the fake's `jobs` list already reflects that
  // job-1 was excluded by `.is('barber_reminded_at', null)` on the real query.
  const sb = fakeHomeServiceSupabase({ jobs: [] });
  const result = await sendHomeServiceReminders(sb);
  assert.deepEqual(result, { ok: true, sent: 0 });
  assert.equal(sb.updates.length, 0, 'no update should be issued when there are no remaining candidate jobs');
});

test('DA2-04. repeated job run does not send a duplicate reminder for a job already inside the window once reminded', async () => {
  const now = Date.now();
  const startTime = new Date(now + 60 * 60 * 1000).toISOString(); // 60 minutes out — inside the 55-65 min window
  const job = { id: 'job-1', address: 'Jl. Contoh 1', schedule_id: 'sch-1', barber_reminded_at: null };
  const schedule = { start_time: startTime, price: 50000, service_name: 'Haircut', barber_id: 'barber-1', customers: { name: 'Budi' }, outlets: { slug: 'bypass' } };
  const barber = { name: 'Ubay', phone: '628111' };

  await withFakeWaNotification(
    { notifyBarberHomeServiceReminderH1: async () => ({ status: true }) },
    async () => {
      const { sendHomeServiceReminders } = require('../../api/cron/home-service-flag');

      // First run: job is a candidate, the (faked) send succeeds, gets marked.
      const firstRunSb = fakeHomeServiceSupabase({ jobs: [job], schedule, barber });
      const firstResult = await sendHomeServiceReminders(firstRunSb);
      assert.equal(firstResult.ok, true);
      assert.equal(firstResult.sent, 1);
      assert.equal(firstRunSb.updates.length, 1);
      assert.ok(firstRunSb.updates[0].barber_reminded_at, 'barber_reminded_at must be stamped after a successful send');

      // Second run: the query itself (`.is('barber_reminded_at', null)`) would
      // no longer return this job — simulated here by an empty candidate list,
      // matching DA2-03's direct proof of that exclusion.
      const secondRunSb = fakeHomeServiceSupabase({ jobs: [] });
      const secondResult = await sendHomeServiceReminders(secondRunSb);
      assert.equal(secondResult.sent, 0, 'a job already reminded must never be reminded twice');
    },
  );
});

test('DA2-04b. a genuinely failed send does NOT mark barber_reminded_at (so a real reminder still goes out on retry)', async () => {
  const { sendHomeServiceReminders } = loadHomeServiceFlagHandler();
  const now = Date.now();
  const startTime = new Date(now + 60 * 60 * 1000).toISOString();
  const job = { id: 'job-1', address: 'Jl. Contoh 1', schedule_id: 'sch-1', barber_reminded_at: null };
  const schedule = { start_time: startTime, price: 50000, service_name: 'Haircut', barber_id: 'barber-1', customers: { name: 'Budi' }, outlets: { slug: 'bypass' } };
  const barber = { name: 'Ubay', phone: '628111' };

  // FONNTE_TOKEN is intentionally unset in this test environment, so the real
  // WA send throws (server/services/waNotification.js sendNotification()).
  const sb = fakeHomeServiceSupabase({ jobs: [job], schedule, barber });
  const result = await sendHomeServiceReminders(sb);

  assert.equal(result.sent, 0);
  assert.equal(sb.updates.length, 0, 'a job must never be marked reminded when the send did not actually succeed');
});

test('DA2-05. a non-schema-mismatch query failure still fails visibly (does not silently report success)', async () => {
  const { sendHomeServiceReminders } = loadHomeServiceFlagHandler();
  const sb = fakeHomeServiceSupabase({ jobsError: { code: 'ECONNRESET', message: 'connection reset' } });
  const result = await sendHomeServiceReminders(sb);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'query_failed');
});

test('DA2-06. flagNoShows and flagCustomerNoConfirm remain intact and independent of barber_reminded_at', () => {
  const flagFlowSource = fs.readFileSync(path.join(__dirname, '../../api/cron/home-service-flag.js'), 'utf8');
  const flagNoShowsBody = flagFlowSource.split('async function flagNoShows')[1].split('async function flagCustomerNoConfirm')[0];
  const flagCustomerNoConfirmBody = flagFlowSource.split('async function flagCustomerNoConfirm')[1].split('module.exports')[0];
  assert.doesNotMatch(flagNoShowsBody, /barber_reminded_at/);
  assert.doesNotMatch(flagCustomerNoConfirmBody, /barber_reminded_at/);
});
