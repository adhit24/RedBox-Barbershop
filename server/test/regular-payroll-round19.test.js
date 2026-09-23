'use strict';

/**
 * Round-19 concurrency regression suite for Codex Round-18 findings:
 *   P1 PRRT_kwDOSNmW7c6lG3sS -- revalidate run-wide coverage after recalculating items.
 *   P1 PRRT_kwDOSNmW7c6lG3sZ -- serialize run summary refreshes.
 *
 * Both are fixed by routing every run-summary write through the serialized DB RPC
 * public.finalize_regular_payroll_run_summary (20260923150000_finalize_regular_payroll_run_summary.sql):
 *   - it recomputes run-wide coverage (population-scoped MAX(attendance_date), eligible-employee count,
 *     workforce revision) FRESH under its own lock and compares against what the caller expected, so a
 *     stale basis is never published (finding #1);
 *   - it recomputes item aggregate totals FRESH from the CURRENT payroll_regular_items rows on every
 *     call, never from a caller-held snapshot, so a "later" writer can never regress the header to an
 *     older total (finding #2).
 * recalculateRegularPayrollRun wraps this in a small bounded retry loop: on STALE_COVERAGE it retries
 * the whole reconciliation+recalculation from fresh state, and fails closed with
 * PAYROLL_RECALC_CONCURRENT_MUTATION (never publishing a stale/guessed summary) once attempts are
 * exhausted.
 *
 * These tests reproduce the exact timing windows the findings describe deterministically -- no sleeps,
 * no reliance on real OS-thread scheduling -- either by intercepting the finalize RPC call at the exact
 * point a concurrent mutation would land, or by manually sequencing the real service functions in the
 * precise order the finding describes ("T1 reads, T2 mutates, T2 writes, T1 attempts stale publish").
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createInMemorySupabase } = require('./helpers/inMemorySupabase');
const {
  generateRegularPayrollDraft,
  recalculateRegularPayrollRun,
  recalculateSingleRegularItem,
  reconcileRegularPayrollPopulation,
  computeRunAttendanceCoverage,
  lockRegularPayrollRun,
} = require('../services/regularPayrollService');

const PERIOD_START = '2026-08-26';
const PERIOD_END = '2026-09-25';

function employee(id, overrides = {}) {
  return {
    id,
    employee_code: id.toUpperCase(),
    name: `Employee ${id}`,
    nickname: id,
    business_unit: 'Redbox',
    branch: 'bypass',
    position: 'Staff',
    base_salary: 3000000,
    position_allowance: 0,
    meal_allowance_rate: 0,
    is_active: true,
    join_date: '2026-08-01',
    employment_type: 'regular',
    ...overrides,
  };
}

function workforce(employees) {
  return {
    employees,
    barbers: [],
    employee_attendance_identity: employees.map((e) => ({
      source: 'fingerprint:bypass',
      external_employee_id: e.id,
      external_name: e.name,
      target_type: 'employee',
      employee_id: e.id,
    })),
    employee_attendance: [],
    employee_overtime_approvals: [],
    attendance_exceptions: [],
    payroll_runs: [],
    payroll_regular_items: [],
    payroll_adjustments: [],
    attendance_import_batches: [],
    payroll_attendance_source_versions: employees.map((e) => ({ employee_id: e.id, source_revision: 0 })),
    payroll_workforce_version: [{ id: 1, revision: 0 }],
  };
}

function addEmployee(store, emp) {
  store.employees.push(emp);
  store.employee_attendance_identity.push({
    source: 'fingerprint:bypass',
    external_employee_id: emp.id,
    external_name: emp.name,
    target_type: 'employee',
    employee_id: emp.id,
  });
  store.payroll_attendance_source_versions.push({ employee_id: emp.id, source_revision: 0 });
}

function fillAttendance(store, employeeId, startDate = PERIOD_START, endDate = PERIOD_END) {
  const current = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (current <= end) {
    const date = current.toISOString().slice(0, 10);
    store.employee_attendance.push({
      id: `att-${employeeId}-${date}`,
      employee_id: employeeId,
      attendance_date: date,
      status: 'hadir',
      first_check_in: `${date} 08:00:00`,
      last_check_out: `${date} 17:00:00`,
      late_minutes: 0,
      overtime_minutes: 0,
    });
    current.setUTCDate(current.getUTCDate() + 1);
  }
}

async function createRun() {
  const store = workforce([employee('emp-a')]);
  fillAttendance(store, 'emp-a');
  const supabase = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(supabase, {
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });
  return { store, supabase, runId: draft.run_id };
}

function itemFor(store, runId, employeeId) {
  return store.payroll_regular_items.find(
    (item) => item.payroll_run_id === runId && item.employee_id === employeeId
  );
}

function runRow(store, runId) {
  return store.payroll_runs.find((r) => r.id === runId);
}

/**
 * Wraps an in-memory supabase double so a hook fires on every call to the serialized finalize RPC,
 * BEFORE the call is actually evaluated -- the exact window a concurrent mutation would land in
 * production (between Node capturing its expected basis and the DB re-validating it under lock).
 * `hook(callNumber, args)` may mutate `store` (including via `supabase` itself) and is awaited first.
 */
function withFinalizeHook(supabase, hook) {
  let callNumber = 0;
  return {
    from: supabase.from,
    async rpc(fn, args) {
      if (fn === 'finalize_regular_payroll_run_summary') {
        callNumber += 1;
        if (hook) await hook(callNumber, args);
      }
      return supabase.rpc(fn, args);
    },
  };
}

async function deleteAttendanceRow(supabase, id) {
  const { error } = await supabase.from('employee_attendance').delete().eq('id', id);
  assert.equal(error, null);
}

// 1. COVERAGE ROW DELETED MID-RECALC -----------------------------------------------------------------

test('coverage row deleted mid-recalc: stale Sep 25 basis is never published; recalc retries and converges', async () => {
  const { store, supabase, runId } = await createRun(); // emp-a full attendance through Sep 25
  const wrapped = withFinalizeHook(supabase, async (call) => {
    if (call === 1) {
      // The newest attendance row is deleted (and the source revision bumped by the real trigger)
      // strictly between Node capturing runCoverage=Sep25 and the serialized publish -- the exact
      // window PRRT_kwDOSNmW7c6lG3sS describes.
      await deleteAttendanceRow(supabase, 'att-emp-a-2026-09-25');
    }
  });

  const result = await recalculateRegularPayrollRun(wrapped, runId);

  assert.equal(result.attempts, 2, 'attempt 1 must be rejected as stale; attempt 2 recomputes and publishes');
  const run = runRow(store, runId);
  const item = itemFor(store, runId, 'emp-a');
  // The published summary must never claim Sep 25 once that row is gone -- it must reflect the
  // post-deletion authoritative cutoff, and the item snapshot must agree with it.
  assert.equal(run.summary.attendance_data_through, '2026-09-24');
  assert.equal(item.attendance_summary.attendance_data_through, '2026-09-24');
  assert.equal(run.summary.attendance_period_complete, false);
});

// 2. COVERAGE ADVANCES MID-RECALC ---------------------------------------------------------------------

test('coverage advances mid-recalc: stale Sep 20 basis is never published as final; recalc retries and converges to Sep 25', async () => {
  const store = workforce([employee('emp-a')]);
  fillAttendance(store, 'emp-a', PERIOD_START, '2026-09-20'); // partial: run coverage starts at Sep 20
  const supabase = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(supabase, {
    periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id',
  });
  const runId = draft.run_id;
  assert.equal(runRow(store, runId).summary.attendance_data_through, '2026-09-20');

  const wrapped = withFinalizeHook(supabase, async (call) => {
    if (call === 1) {
      // New attendance rows land (advancing the authoritative cutoff to Sep 25) strictly between Node's
      // coverage read and the serialized publish.
      fillAttendance(store, 'emp-a', '2026-09-21', PERIOD_END);
      // Mirror the real DB trigger: attendance changing bumps the source revision.
      const rec = store.payroll_attendance_source_versions.find((v) => v.employee_id === 'emp-a');
      rec.source_revision += 1;
    }
  });

  const result = await recalculateRegularPayrollRun(wrapped, runId, { all: true });

  assert.equal(result.attempts, 2, 'attempt 1 must be rejected as stale (Sep 20 basis is now behind reality)');
  const run = runRow(store, runId);
  const item = itemFor(store, runId, 'emp-a');
  assert.equal(run.summary.attendance_data_through, PERIOD_END);
  assert.equal(item.attendance_summary.attendance_data_through, PERIOD_END);
  assert.equal(run.summary.attendance_period_complete, true);
});

// 3. CONCURRENT EMPLOYEE RECALCULATIONS ----------------------------------------------------------------

test('concurrent employee recalculations: a stale-snapshot publish can never overwrite a newer committed item with older totals', async () => {
  const { store, supabase, runId } = await createRun(); // emp-a
  addEmployee(store, employee('emp-b'));
  fillAttendance(store, 'emp-b');
  await recalculateRegularPayrollRun(supabase, runId); // bring B in; both READY, coverage stable at Sep 25

  const before = runRow(store, runId).summary;

  // "A" captures its basis (Phase A) BEFORE "B" runs -- this is A's stale read (T1 reads).
  const populationA = await reconcileRegularPayrollPopulation(supabase, runId);
  const itemsA = store.payroll_regular_items.filter((i) => i.payroll_run_id === runId);
  const employeeIdsA = itemsA.map((i) => i.employee_id).sort();
  const coverageA = await computeRunAttendanceCoverage(supabase, { periodStart: PERIOD_START, periodEnd: PERIOD_END, employeeIds: employeeIdsA });

  // "B" fully recalculates and publishes a NEWER, correct summary in the meantime (T2 mutates, T2 writes):
  // give B a manual bonus so its own total visibly changes, then recalculate + publish through the real
  // per-item path (recalculateSingleRegularItem already serializes its own summary refresh).
  const itemB = itemFor(store, runId, 'emp-b');
  itemB.manual_bonus = 500000;
  itemB.gross_pay = Number(itemB.gross_pay) + 500000;
  itemB.take_home_pay = Number(itemB.take_home_pay) + 500000;
  await supabase.rpc('finalize_regular_payroll_run_summary', { p_run_id: runId }); // B "publishes"
  const afterB = runRow(store, runId).summary;
  assert.equal(afterB.total_gross_pay, before.total_gross_pay + 500000, 'sanity: B is now reflected');

  // "A" now attempts to publish using ITS stale captured basis (T1 attempts stale publication). Coverage
  // itself did not change, so this call is NOT rejected as STALE_COVERAGE -- but it must still recompute
  // totals FRESH from the current rows rather than trusting A's old view, so B's update is never lost.
  const { data: finalizeA } = await supabase.rpc('finalize_regular_payroll_run_summary', {
    p_run_id: runId,
    p_employee_ids: employeeIdsA,
    p_expected_attendance_data_through: coverageA.attendance_data_through,
    p_expected_attendance_period_complete: coverageA.attendance_period_complete,
    p_expected_workforce_version: 0,
    p_expected_eligible_count: populationA.eligible_count,
  });

  assert.equal(finalizeA.status, 'PUBLISHED');
  const finalSummary = runRow(store, runId).summary;
  assert.equal(finalSummary.total_gross_pay, before.total_gross_pay + 500000, "A's stale publish must not roll back B's committed total");
  const liveTotal = store.payroll_regular_items
    .filter((i) => i.payroll_run_id === runId)
    .reduce((s, i) => s + Number(i.gross_pay), 0);
  assert.equal(finalSummary.total_gross_pay, liveTotal, 'final header must match the final item set exactly');
});

// 4. TWO SIMULTANEOUS SUMMARY PUBLICATIONS -------------------------------------------------------------

test('two simultaneous summary publications: concurrent per-item recalculations converge to one deterministic, complete summary', async () => {
  const { store, supabase, runId } = await createRun(); // emp-a
  addEmployee(store, employee('emp-b'));
  fillAttendance(store, 'emp-b');
  await recalculateRegularPayrollRun(supabase, runId); // bring B in

  const itemA = itemFor(store, runId, 'emp-a');
  const itemB = itemFor(store, runId, 'emp-b');

  // Two independent per-item recalculations (each ending in its own serialized summary refresh, exactly
  // like two concurrent HTTP requests each reviewing a different employee's overtime) dispatched together.
  const [resA, resB] = await Promise.all([
    recalculateSingleRegularItem(supabase, runId, itemA.id, { refreshOvertime: true }),
    recalculateSingleRegularItem(supabase, runId, itemB.id, { refreshOvertime: true }),
  ]);
  assert.ok(resA && resB, 'both concurrent recalculations must succeed');

  const summary = runRow(store, runId).summary;
  const liveTotal = store.payroll_regular_items
    .filter((i) => i.payroll_run_id === runId)
    .reduce((s, i) => s + Number(i.gross_pay), 0);
  assert.equal(summary.total_gross_pay, liveTotal, 'the published summary must match the live item rows exactly, regardless of which request published last');
  assert.equal(summary.total_employees, 2);
});

// 5. STALE EXPECTED REVISION REJECTED --------------------------------------------------------------------

test('stale expected revision rejected: a deliberately wrong workforce/eligible/coverage token is refused, nothing is written', async () => {
  const { store, supabase, runId } = await createRun();
  const before = JSON.stringify(runRow(store, runId).summary);

  const { data } = await supabase.rpc('finalize_regular_payroll_run_summary', {
    p_run_id: runId,
    p_employee_ids: ['emp-a'],
    p_expected_attendance_data_through: '2099-01-01', // deliberately wrong
    p_expected_attendance_period_complete: true,
    p_expected_workforce_version: 999, // deliberately wrong
    p_expected_eligible_count: 999, // deliberately wrong
  });

  assert.equal(data.success, false);
  assert.equal(data.status, 'STALE_COVERAGE');
  assert.equal(data.actual.attendance_data_through, PERIOD_END);
  assert.equal(JSON.stringify(runRow(store, runId).summary), before, 'no write must occur on a conflict');
});

// 6. STABLE NORMAL RECALC -------------------------------------------------------------------------------

test('stable normal recalc: no concurrent mutation -> single successful pass, summary updated normally', async () => {
  const { store, supabase, runId } = await createRun();
  const item = itemFor(store, runId, 'emp-a');
  item.attendance_summary.attendance_dirty = true;

  const result = await recalculateRegularPayrollRun(supabase, runId, { all: false });

  assert.equal(result.attempts, 1);
  assert.equal(result.recalculated_count, 1);
  const run = runRow(store, runId);
  assert.equal(run.summary.attendance_data_through, PERIOD_END);
  assert.equal(run.summary.attendance_period_complete, true);
});

// 7. BOUNDED RETRY EXHAUSTION ------------------------------------------------------------------------

test('bounded retry exhaustion: continuous coverage mutation fails closed with PAYROLL_RECALC_CONCURRENT_MUTATION, never publishes a stale summary', async () => {
  const { store, supabase, runId } = await createRun();
  const beforeSummary = JSON.stringify(runRow(store, runId).summary);
  let mutations = 0;

  const lastDayId = 'att-emp-a-2026-09-25';
  const wrapped = withFinalizeHook(supabase, async (call, args) => {
    // Only the OUTER, coverage-validating finalize call (p_employee_ids set) matters here -- the INNER
    // per-item summary refresh inside recalculateSingleRegularItem also goes through this same RPC (with
    // p_employee_ids = null) and must be left alone, or toggling on every call would cancel itself out
    // within a single attempt. Every single outer attempt gets invalidated by a fresh mutation, strictly
    // between Node's coverage capture and the finalize call -- attendance keeps changing faster than
    // recalculation can converge. Toggling the last day's row in and out flips attendance_data_through
    // every attempt, so whatever Node just captured is guaranteed to already be wrong by validation time.
    if (!args.p_employee_ids) return;
    mutations += 1;
    if (store.employee_attendance.some((r) => r.id === lastDayId)) {
      await deleteAttendanceRow(supabase, lastDayId);
    } else {
      fillAttendance(store, 'emp-a', '2026-09-25', '2026-09-25');
    }
    const rec = store.payroll_attendance_source_versions.find((v) => v.employee_id === 'emp-a');
    rec.source_revision += 1;
  });

  await assert.rejects(
    () => recalculateRegularPayrollRun(wrapped, runId, { all: true, maxAttempts: 3 }),
    (err) => {
      assert.equal(err.code, 'PAYROLL_RECALC_CONCURRENT_MUTATION');
      return true;
    }
  );

  assert.ok(mutations >= 3, 'every bounded attempt must have been contested');
  assert.equal(JSON.stringify(runRow(store, runId).summary), beforeSummary, 'a stale/guessed summary must never be published on exhaustion');
});

// 8. LOCK INTERACTION -----------------------------------------------------------------------------------

test('lock interaction: stable recalc still locks cleanly; a run left mid-conflict never locks until a stable recalc succeeds', async () => {
  const { store, supabase, runId } = await createRun();
  const result = await recalculateRegularPayrollRun(supabase, runId, { all: true });
  assert.equal(result.attempts, 1);

  const locked = await lockRegularPayrollRun(supabase, { runId, userEmail: 'owner@redbox.id' });
  assert.equal(locked.status, 'LOCKED');
});

// 9. MANUAL OVERTIME BEHAVIOR UNAFFECTED ------------------------------------------------------------------

test('manual overtime override behavior is unaffected by the serialized finalize path', async () => {
  const store = workforce([employee('emp-a')]);
  fillAttendance(store, 'emp-a'); // no overtime on attendance -> attendance-derived approved minutes = 0
  const supabase = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(supabase, {
    periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id',
    itemOverrides: { 'emp-a': { approved_overtime_hours: 1.5 } },
  });
  const runId = draft.run_id;
  let item = itemFor(store, runId, 'emp-a');
  assert.equal(item.attendance_summary.overtime_source, 'MANUAL_OVERRIDE');
  assert.equal(item.overtime_amount, 11250);

  const result = await recalculateRegularPayrollRun(supabase, runId, { all: true });
  assert.equal(result.attempts, 1);
  item = itemFor(store, runId, 'emp-a');
  assert.equal(item.attendance_summary.overtime_source, 'MANUAL_OVERRIDE', 'the override survives the serialized recalc/finalize path');
  assert.equal(item.overtime_amount, 11250);

  const locked = await lockRegularPayrollRun(supabase, { runId, userEmail: 'owner@redbox.id' });
  assert.equal(locked.status, 'LOCKED');
});

// 10. BARBER PAYROLL UNAFFECTED ---------------------------------------------------------------------------

test('Barber payroll is never touched by the serialized finalize RPC', async () => {
  const store = workforce([employee('emp-a')]);
  store.payroll_runs.push({
    id: 'barber-run-1', payroll_type: 'BARBER', business_unit: 'Redbox', status: 'DRAFT',
    period_start: PERIOD_START, period_end: PERIOD_END, summary: { total_employees: 0 },
  });
  store.payroll_barber_items = [];
  const supabase = createInMemorySupabase(store);

  const population = await reconcileRegularPayrollPopulation(supabase, 'barber-run-1');
  assert.deepEqual(population, { inserted: [], flagged_no_longer_eligible: [], eligible_count: 0 });

  const { data } = await supabase.rpc('finalize_regular_payroll_run_summary', { p_run_id: 'barber-run-1' });
  assert.equal(data.status, 'PUBLISHED');
  assert.equal(data.summary.total_employees, 0, 'a BARBER run has no payroll_regular_items rows to aggregate');
  assert.deepEqual(store.payroll_barber_items, [], 'Barber-specific tables are never touched by this RPC');
});
