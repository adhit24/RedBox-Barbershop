'use strict';

/**
 * Round-17 regression suite for Codex Round-16 finding PRRT_kwDOSNmW7c6ksqma.
 *
 * Invariant under test: ALL payroll items inside one Regular Payroll run must be calculated from the
 * SAME authoritative run-wide coverage basis. A clean/READY item's own per-item dirty/revision flags
 * never change just because a DIFFERENT employee's insertion (or a later attendance correction) moved
 * the run-wide cutoff -- so a clean/READY status must never, by itself, prevent recalculation after the
 * run-wide coverage changes, in EITHER direction (advance or regression).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createInMemorySupabase } = require('./helpers/inMemorySupabase');
const {
  generateRegularPayrollDraft,
  recalculateRegularPayrollRun,
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

/** Sole employee A has attendance ONLY through 2026-09-10 at draft time: the run's authoritative
 * coverage (and A's own snapshot) is calculated against a Sep-10 cutoff, and A comes out clean/READY
 * because A's OWN 16-day window is fully covered. */
async function createRunWithPartialCoverage() {
  const store = workforce([employee('emp-a')]);
  fillAttendance(store, 'emp-a', PERIOD_START, '2026-09-10');
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

// 1. COVERAGE ADVANCES ------------------------------------------------------------------------------

test('coverage advances: inserting B pushes run coverage from Sep 10 to Sep 25 and forces A off its clean Sep 10 snapshot', async () => {
  const { store, supabase, runId } = await createRunWithPartialCoverage();
  const before = itemFor(store, runId, 'emp-a');
  assert.equal(before.status, 'READY', 'A must start clean/READY against its own Sep-10 window');
  assert.equal(before.attendance_summary.attendance_data_through, '2026-09-10');

  const run0 = store.payroll_runs.find((row) => row.id === runId);
  assert.equal(run0.summary.attendance_data_through, '2026-09-10');
  assert.equal(run0.summary.attendance_period_complete, false);

  addEmployee(store, employee('emp-b'));
  fillAttendance(store, 'emp-b'); // full period through Sep 25

  const result = await recalculateRegularPayrollRun(supabase, runId);

  assert.deepEqual(result.population.inserted, ['emp-b']);
  // Both A (coverage-invalidated) and B (newly inserted) must be recalculated in this one request.
  assert.equal(result.recalculated_count, 2);
  assert.deepEqual(result.items.map((i) => i.employee_id).sort(), ['emp-a', 'emp-b']);

  const a = itemFor(store, runId, 'emp-a');
  const b = itemFor(store, runId, 'emp-b');
  const run = store.payroll_runs.find((row) => row.id === runId);

  // A no longer retains its Sep-10 snapshot; it now reflects the Sep-25 authoritative basis.
  assert.equal(a.attendance_summary.attendance_data_through, '2026-09-25');
  assert.equal(a.attendance_summary.expected_coverage_days, 31);
  assert.equal(a.attendance_summary.records_count, 16, 'A has no new attendance rows past Sep 10');
  // 16/31 < 0.9 coverage ratio -> A must now be flagged, never silently left READY/locked at Sep 25.
  assert.equal(a.status, 'REVIEW_REQUIRED');

  assert.equal(b.attendance_summary.attendance_data_through, '2026-09-25');
  assert.equal(b.status, 'READY');

  // Summary refreshed only AFTER both items were recalculated, and reflects the final Sep-25 basis.
  assert.equal(run.summary.attendance_data_through, '2026-09-25');
  assert.equal(run.summary.attendance_period_complete, true);

  await assert.rejects(
    () => lockRegularPayrollRun(supabase, { runId, userEmail: 'owner@redbox.id' }),
    /review-required|review required/i,
    'the run must not be lockable while A is stale/REVIEW_REQUIRED'
  );
});

// 2. COVERAGE REGRESSES ------------------------------------------------------------------------------

test('coverage regresses: removing late attendance rows pulls run coverage from Sep 25 back to Sep 20 and recalculates the untouched item', async () => {
  const { store, supabase, runId } = await createRun(); // emp-a full through Sep 25, READY
  const before = itemFor(store, runId, 'emp-a');
  assert.equal(before.status, 'READY');
  assert.equal(before.attendance_summary.attendance_data_through, PERIOD_END);

  // Simulate a data correction removing bad late-period attendance rows (a regression of the
  // authoritative run-wide coverage). Nothing marks the item dirty and no population change occurs.
  const kept = store.employee_attendance.filter((r) => r.attendance_date <= '2026-09-20');
  store.employee_attendance.length = 0;
  store.employee_attendance.push(...kept);

  const result = await recalculateRegularPayrollRun(supabase, runId);

  assert.deepEqual(result.population.inserted, []);
  assert.equal(result.recalculated_count, 1, 'the untouched item must still be recalculated on coverage regression');
  assert.equal(result.items[0].employee_id, 'emp-a');

  const after = itemFor(store, runId, 'emp-a');
  const run = store.payroll_runs.find((row) => row.id === runId);

  assert.equal(after.attendance_summary.attendance_data_through, '2026-09-20');
  assert.equal(after.attendance_summary.records_count, kept.length);
  assert.equal(run.summary.attendance_data_through, '2026-09-20');
  assert.equal(run.summary.attendance_period_complete, false);
});

// 3. TARGETED RECALC, COVERAGE UNCHANGED --------------------------------------------------------------

test('targeted recalc, coverage unchanged: unrelated clean item is left untouched', async () => {
  const { store, supabase, runId } = await createRun();
  addEmployee(store, employee('emp-c'));
  fillAttendance(store, 'emp-c'); // full period: does not move the Sep-25 cutoff
  await recalculateRegularPayrollRun(supabase, runId); // bring C in, coverage stays Sep 25 throughout

  const runAfterInsert = store.payroll_runs.find((row) => row.id === runId);
  assert.equal(runAfterInsert.summary.attendance_data_through, PERIOD_END);

  const a = itemFor(store, runId, 'emp-a');
  a.attendance_summary.attendance_dirty = true; // only A is requested/dirty this time

  const result = await recalculateRegularPayrollRun(supabase, runId, { all: false });

  assert.deepEqual(result.population.inserted, []);
  assert.equal(result.recalculated_count, 1, 'C must remain untouched: not dirty, not inserted, coverage unchanged');
  assert.equal(result.items[0].employee_id, 'emp-a');
});

// 4. INSERTED EMPLOYEE, CUTOFF UNCHANGED ---------------------------------------------------------------

test('inserted employee, cutoff unchanged: B is recalculated in the same request, unrelated clean items stay untouched', async () => {
  const { store, supabase, runId } = await createRun(); // A full through Sep 25
  addEmployee(store, employee('emp-c'));
  fillAttendance(store, 'emp-c');
  await recalculateRegularPayrollRun(supabase, runId); // C in, cutoff stays Sep 25

  addEmployee(store, employee('emp-b'));
  fillAttendance(store, 'emp-b'); // also full through Sep 25: cutoff does not move

  const before = store.payroll_runs.find((row) => row.id === runId).summary.attendance_data_through;
  const result = await recalculateRegularPayrollRun(supabase, runId);
  const after = store.payroll_runs.find((row) => row.id === runId).summary.attendance_data_through;

  assert.equal(before, PERIOD_END);
  assert.equal(after, PERIOD_END, 'authoritative cutoff must be unchanged by this insertion');
  assert.deepEqual(result.population.inserted, ['emp-b']);
  assert.equal(result.recalculated_count, 1, 'only newly inserted B is recalculated; A and C stay untouched');
  assert.equal(result.items[0].employee_id, 'emp-b');
});

// 5. MID-PERIOD JOINER ----------------------------------------------------------------------------------

test('mid-period joiner: inserted B with join_date Sep 10 gets coverage Sep 10 -> Sep 25 even while advancing the run cutoff', async () => {
  const { store, supabase, runId } = await createRunWithPartialCoverage(); // A alone, cutoff Sep 10
  addEmployee(store, employee('emp-b', { join_date: '2026-09-10' }));
  fillAttendance(store, 'emp-b', '2026-09-10', PERIOD_END); // pushes run cutoff to Sep 25

  await recalculateRegularPayrollRun(supabase, runId);
  const b = itemFor(store, runId, 'emp-b');

  assert.equal(b.attendance_summary.attendance_data_through, PERIOD_END);
  assert.equal(b.attendance_summary.expected_coverage_days, 16, 'window starts at join_date, not period_start');
  assert.equal(b.attendance_summary.records_count, 16);
  assert.equal(b.status, 'READY');
});

// 6. SUMMARY ORDERING -------------------------------------------------------------------------------

test('summary ordering: after recalculation every item shares the same coverage basis as the refreshed run summary', async () => {
  const { store, supabase, runId } = await createRunWithPartialCoverage();
  addEmployee(store, employee('emp-b'));
  fillAttendance(store, 'emp-b');

  await recalculateRegularPayrollRun(supabase, runId);

  const run = store.payroll_runs.find((row) => row.id === runId);
  const items = store.payroll_regular_items.filter((i) => i.payroll_run_id === runId);
  assert.ok(items.length >= 2);
  for (const item of items) {
    assert.equal(
      item.attendance_summary.attendance_data_through,
      run.summary.attendance_data_through,
      `item ${item.employee_id} must not retain a stale coverage cutoff after the summary was refreshed`
    );
  }
  assert.equal(run.summary.attendance_period_complete, true);
});
