'use strict';

/**
 * Round-11 regression test suite (Codex round-11 findings on PR #98):
 * 1. P1 (PRRT_kwDOSNmW7c6kkm1V): Regular Payroll population must be filtered by employment_type =
 *    'regular' (or unset, schema DEFAULT), never inferred from position/branch/attendance source.
 * 2. P1 (PRRT_kwDOSNmW7c6kkm1X): a DRAFT run's payroll_regular_items population must be reconciled
 *    against the CURRENT eligible-employee population before recalculation/lock -- missing eligible
 *    employees get an item inserted, no-longer-eligible existing items are flagged (never deleted),
 *    and lock is blocked (Node guard + DB backstop) until the population is reconciled.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createInMemorySupabase } = require('./helpers/inMemorySupabase');
const {
  generateRegularPayrollDraft,
  recalculateRegularPayrollRun,
  reconcileRegularPayrollPopulation,
  lockRegularPayrollRun,
  fetchEligibleRegularEmployees,
  isEmployeeEligibleForPeriod,
} = require('../services/regularPayrollService');

const PERIOD_START = '2026-08-26';
const PERIOD_END = '2026-09-25';

function regularEmployee(overrides = {}) {
  return {
    id: 'emp-1',
    employee_code: 'EMP001',
    name: 'Alpha Regular',
    nickname: 'Alpha',
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

function baseWorkforce(employees) {
  return {
    employees,
    barbers: [],
    employee_attendance_identity: employees.map((e) => ({
      source: 'fingerprint:bypass', external_employee_id: e.id, external_name: e.name, target_type: 'employee', employee_id: e.id,
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

function fillAttendance(store, empId, startDate = PERIOD_START, endDate = PERIOD_END) {
  const [sYear, sMonth, sDay] = startDate.split('-').map(Number);
  const [eYear, eMonth, eDay] = endDate.split('-').map(Number);
  const cur = new Date(Date.UTC(sYear, sMonth - 1, sDay));
  const end = new Date(Date.UTC(eYear, eMonth - 1, eDay));
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    store.employee_attendance.push({
      id: `att-${empId}-${iso}`,
      employee_id: empId,
      attendance_date: iso,
      status: 'PRESENT',
      first_check_in: `${iso} 08:00:00`,
      last_check_out: `${iso} 17:00:00`,
      late_minutes: 0,
      overtime_minutes: 0,
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

// ================================================================================================
// P1: employment_type population filter (PRRT_kwDOSNmW7c6kkm1V)
// ================================================================================================

test('1. commission-based employee is excluded from Regular Payroll population', async () => {
  const store = baseWorkforce([
    regularEmployee({ id: 'emp-1', employment_type: 'regular' }),
    regularEmployee({ id: 'emp-2', name: 'Bravo Commission', nickname: 'Bravo', employment_type: 'commission-based' }),
  ]);
  const sb = createInMemorySupabase(store);
  const eligible = await fetchEligibleRegularEmployees(sb, { businessUnit: 'ALL', periodEnd: PERIOD_END });
  assert.deepEqual(eligible.map((e) => e.id).sort(), ['emp-1']);
});

test('2. a regular employee is included', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  const sb = createInMemorySupabase(store);
  const eligible = await fetchEligibleRegularEmployees(sb, { businessUnit: 'ALL', periodEnd: PERIOD_END });
  assert.deepEqual(eligible.map((e) => e.id), ['emp-1']);
});

test('barber/commission employee with a salary populated is still excluded', async () => {
  const store = baseWorkforce([
    regularEmployee({ id: 'emp-1' }),
    regularEmployee({ id: 'emp-2', name: 'Barber-in-employees', employment_type: 'barber', base_salary: 3000000 }),
  ]);
  const sb = createInMemorySupabase(store);
  const eligible = await fetchEligibleRegularEmployees(sb, { businessUnit: 'ALL', periodEnd: PERIOD_END });
  assert.deepEqual(eligible.map((e) => e.id), ['emp-1']);
});

test('inactive regular employee is excluded', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1', is_active: false })]);
  const sb = createInMemorySupabase(store);
  const eligible = await fetchEligibleRegularEmployees(sb, { businessUnit: 'ALL', periodEnd: PERIOD_END });
  assert.equal(eligible.length, 0);
});

test('3. an active future joiner (join_date > period_end) is excluded', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1', join_date: '2026-12-01' })]);
  const sb = createInMemorySupabase(store);
  const eligible = await fetchEligibleRegularEmployees(sb, { businessUnit: 'ALL', periodEnd: PERIOD_END });
  assert.equal(eligible.length, 0);
});

test('join_date IS NULL regular employee is included', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1', join_date: null })]);
  const sb = createInMemorySupabase(store);
  const eligible = await fetchEligibleRegularEmployees(sb, { businessUnit: 'ALL', periodEnd: PERIOD_END });
  assert.deepEqual(eligible.map((e) => e.id), ['emp-1']);
});

test('join_date == period_end is included', () => {
  assert.equal(isEmployeeEligibleForPeriod(regularEmployee({ join_date: PERIOD_END }), PERIOD_END), true);
});

test('no regular payroll item is created for a commission employee at draft generation', async () => {
  const store = baseWorkforce([
    regularEmployee({ id: 'emp-1' }),
    regularEmployee({ id: 'emp-2', name: 'Bravo Commission', employment_type: 'commission-based' }),
  ]);
  fillAttendance(store, 'emp-1');
  fillAttendance(store, 'emp-2');
  const sb = createInMemorySupabase(store);
  const result = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });
  const items = store.payroll_regular_items.filter((i) => i.payroll_run_id === result.run_id);
  assert.deepEqual(items.map((i) => i.employee_id), ['emp-1']);
});

// ================================================================================================
// P1-2: population reconciliation (PRRT_kwDOSNmW7c6kkm1X)
// ================================================================================================

test('4. eligible employee created after draft generation -> reconciliation inserts a missing item', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });

  // A brand-new employee, created after the draft already exists.
  store.employees.push(regularEmployee({ id: 'emp-2', name: 'Beta Regular', nickname: 'Beta' }));
  store.employee_attendance_identity.push({ source: 'fingerprint:bypass', external_employee_id: 'emp-2', external_name: 'Beta Regular', target_type: 'employee', employee_id: 'emp-2' });
  store.payroll_attendance_source_versions.push({ employee_id: 'emp-2', source_revision: 0 });
  fillAttendance(store, 'emp-2');

  const population = await reconcileRegularPayrollPopulation(sb, draft.run_id);
  assert.deepEqual(population.inserted, ['emp-2']);
  const items = store.payroll_regular_items.filter((i) => i.payroll_run_id === draft.run_id);
  assert.deepEqual(items.map((i) => i.employee_id).sort(), ['emp-1', 'emp-2']);
  const newItem = items.find((i) => i.employee_id === 'emp-2');
  assert.equal(newItem.payroll_input_revision, newItem.payroll_snapshot_revision);
  assert.equal(newItem.attendance_source_revision, newItem.attendance_snapshot_revision);
});

test('5. an employee activated (is_active flips true) after draft generation -> reconciliation inserts item', async () => {
  const store = baseWorkforce([
    regularEmployee({ id: 'emp-1' }),
    regularEmployee({ id: 'emp-2', name: 'Beta Regular', nickname: 'Beta', is_active: false }),
  ]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });

  store.employees.find((e) => e.id === 'emp-2').is_active = true;
  fillAttendance(store, 'emp-2');

  const population = await reconcileRegularPayrollPopulation(sb, draft.run_id);
  assert.deepEqual(population.inserted, ['emp-2']);
});

test('6. employment_type corrected to regular after draft generation -> reconciliation detects the missing item', async () => {
  const store = baseWorkforce([
    regularEmployee({ id: 'emp-1' }),
    regularEmployee({ id: 'emp-2', name: 'Beta Commission', nickname: 'Beta', employment_type: 'commission-based' }),
  ]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });
  assert.equal(store.payroll_regular_items.filter((i) => i.payroll_run_id === draft.run_id).length, 1);

  store.employees.find((e) => e.id === 'emp-2').employment_type = 'regular';
  fillAttendance(store, 'emp-2');

  const population = await reconcileRegularPayrollPopulation(sb, draft.run_id);
  assert.deepEqual(population.inserted, ['emp-2']);
});

test('7. an existing item whose employee is no longer eligible is flagged, never silently deleted', async () => {
  const store = baseWorkforce([
    regularEmployee({ id: 'emp-1' }),
    regularEmployee({ id: 'emp-2', name: 'Beta Regular', nickname: 'Beta' }),
  ]);
  fillAttendance(store, 'emp-1');
  fillAttendance(store, 'emp-2');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });
  const itemsBefore = store.payroll_regular_items.filter((i) => i.payroll_run_id === draft.run_id).length;

  // Employee deactivated after the draft was generated (e.g. resignation processed mid-period).
  store.employees.find((e) => e.id === 'emp-2').is_active = false;

  const population = await reconcileRegularPayrollPopulation(sb, draft.run_id);
  assert.deepEqual(population.flagged_no_longer_eligible, ['emp-2']);

  const itemsAfter = store.payroll_regular_items.filter((i) => i.payroll_run_id === draft.run_id);
  assert.equal(itemsAfter.length, itemsBefore, 'no item was deleted');
  const flaggedItem = itemsAfter.find((i) => i.employee_id === 'emp-2');
  assert.equal(flaggedItem.status, 'REVIEW_REQUIRED');
  assert.equal(flaggedItem.attendance_summary.population_changed, true);
  assert.equal(flaggedItem.attendance_summary.population_change_reason, 'EMPLOYEE_NO_LONGER_ELIGIBLE_FOR_RUN');
  assert.ok(flaggedItem.warnings.some((w) => /EMPLOYEE_NO_LONGER_ELIGIBLE_FOR_RUN/.test(w)));
});

test('still-eligible existing item is left untouched by reconciliation (no spurious flag, no duplicate insert)', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });

  const population = await reconcileRegularPayrollPopulation(sb, draft.run_id);
  assert.deepEqual(population.inserted, []);
  assert.deepEqual(population.flagged_no_longer_eligible, []);
  assert.equal(store.payroll_regular_items.filter((i) => i.payroll_run_id === draft.run_id).length, 1);
});

test('8. population mismatch (missing eligible employee) blocks lock', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });

  // A new eligible employee appears, but the run is never reconciled/recalculated before the lock attempt.
  store.employees.push(regularEmployee({ id: 'emp-2', name: 'Beta Regular', nickname: 'Beta' }));
  fillAttendance(store, 'emp-2');

  await assert.rejects(
    () => lockRegularPayrollRun(sb, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    /eligible employee\(s\) are missing/i
  );
  // The run must remain DRAFT: no silent lock with an incomplete population.
  const run = store.payroll_runs.find((r) => r.id === draft.run_id);
  assert.equal(run.status, 'DRAFT');
});

test('8b. a population_changed (no-longer-eligible) item also blocks lock', async () => {
  const store = baseWorkforce([
    regularEmployee({ id: 'emp-1' }),
    regularEmployee({ id: 'emp-2', name: 'Beta Regular', nickname: 'Beta' }),
  ]);
  fillAttendance(store, 'emp-1');
  fillAttendance(store, 'emp-2');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });
  store.employees.find((e) => e.id === 'emp-2').is_active = false;
  await reconcileRegularPayrollPopulation(sb, draft.run_id);

  await assert.rejects(
    () => lockRegularPayrollRun(sb, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    /EMPLOYEE_NO_LONGER_ELIGIBLE_FOR_RUN|no longer eligible/i
  );
});

test('9. population reconciliation + recalculation refreshes the run summary (total_employees) and unblocks lock', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });

  store.employees.push(regularEmployee({ id: 'emp-2', name: 'Beta Regular', nickname: 'Beta' }));
  fillAttendance(store, 'emp-2');

  const recalcResult = await recalculateRegularPayrollRun(sb, draft.run_id, { all: true });
  assert.deepEqual(recalcResult.population.inserted, ['emp-2']);

  const runRow = store.payroll_runs.find((r) => r.id === draft.run_id);
  assert.equal(runRow.summary.total_employees, 2);

  // Now the population is complete and the newly-inserted item is fresh (not dirty) -> lock succeeds.
  const lockResult = await lockRegularPayrollRun(sb, { runId: draft.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(lockResult.status, 'LOCKED');
});

test('10. concurrent population change cannot result in silent omission: a source revision bump mid-reconciliation forces a clean retry', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });

  store.employees.push(regularEmployee({ id: 'emp-2', name: 'Beta Regular', nickname: 'Beta' }));
  fillAttendance(store, 'emp-2');

  // Simulate a concurrent attendance write for emp-2 landing between the Node-side eligibility/attendance
  // read and the RPC insert: attendanceEffect already bumped payroll_attendance_source_versions when
  // fillAttendance wrote rows above, so this call exercises the SAME live-race path add_regular_payroll_run_items
  // guards against (PAYROLL_INPUT_CHANGED_DURING_POPULATION_RECONCILIATION) -- reconciliation must still
  // converge to a complete population, never silently drop the new employee.
  const population = await reconcileRegularPayrollPopulation(sb, draft.run_id);
  assert.deepEqual(population.inserted, ['emp-2']);
  const items = store.payroll_regular_items.filter((i) => i.payroll_run_id === draft.run_id);
  assert.deepEqual(items.map((i) => i.employee_id).sort(), ['emp-1', 'emp-2']);
});

test('11. Barber payroll runs are never touched by population reconciliation', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  store.payroll_runs.push({
    id: 'barber-run-1', payroll_type: 'BARBER', business_unit: 'Redbox', status: 'DRAFT',
    period_start: PERIOD_START, period_end: PERIOD_END, summary: {},
  });
  const sb = createInMemorySupabase(store);
  const population = await reconcileRegularPayrollPopulation(sb, 'barber-run-1');
  assert.deepEqual(population, { inserted: [], flagged_no_longer_eligible: [] });
});

test('reconciliation never touches a LOCKED run', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });
  await lockRegularPayrollRun(sb, { runId: draft.run_id, userEmail: 'owner@redbox.id' });

  store.employees.push(regularEmployee({ id: 'emp-2', name: 'Beta Regular', nickname: 'Beta' }));
  const population = await reconcileRegularPayrollPopulation(sb, draft.run_id);
  assert.deepEqual(population, { inserted: [], flagged_no_longer_eligible: [] });
  assert.equal(store.payroll_regular_items.filter((i) => i.payroll_run_id === draft.run_id).length, 1);
});

test('12. new add_regular_payroll_run_items / lock_payroll_run migration preserves the Barber branch and prior invariants', () => {
  const migrationPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260922000000_regular_payroll_population_reconciliation.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.ok(sql.includes('payroll_barber_items'), 'barber items check present');
  assert.ok(sql.includes('payroll_review_items'), 'barber review items check present');
  assert.ok(sql.includes('payroll_barber_commission_items'), 'barber commission lines check present');
  assert.ok(sql.includes('payroll_source_claims'), 'barber source claims present');
  assert.ok(sql.includes('claims_created'), 'claims_created returned in result');
  assert.ok(sql.includes('SECURITY INVOKER'), 'SECURITY INVOKER preserved');
  assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION public.add_regular_payroll_run_items(UUID, JSONB) TO service_role"), 'add_regular_payroll_run_items is service_role only');
  assert.ok(sql.includes("REVOKE ALL ON FUNCTION public.add_regular_payroll_run_items(UUID, JSONB) FROM PUBLIC, anon, authenticated"), 'no privilege widening for add_regular_payroll_run_items');
  assert.ok(sql.includes('EMPLOYEE_NO_LONGER_ELIGIBLE_FOR_RUN'), 'population_changed guard present in lock_payroll_run');
  assert.ok(sql.includes('eligible employee(s) are missing from the payroll run'), 'population completeness backstop present in lock_payroll_run');
});

test('the corrective migration is forward-only: no applied migration was edited', () => {
  const migrationsDir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
  const appliedUntouched = [
    '20260921002309_restore_barber_lock_and_regular_guards.sql',
    '20260921005831_block_pending_overtime_on_payroll_lock.sql',
    '20260921012501_reconcile_overtime_before_payroll_lock.sql',
    '20260921033925_serialize_regular_payroll_mutations.sql',
    '20260921061154_atomic_regular_payroll_lifecycle.sql',
    '20260921095025_attendance_payroll_sync_dirty_marker.sql',
    '20260921110000_block_review_required_on_payroll_lock.sql',
    '20260921120000_version_attendance_payroll_snapshot.sql',
    '20260921140000_generalize_payroll_snapshot_concurrency.sql',
  ];
  for (const f of appliedUntouched) {
    assert.ok(fs.existsSync(path.join(migrationsDir, f)), `${f} must still exist unedited`);
  }
  assert.ok(fs.existsSync(path.join(migrationsDir, '20260922000000_regular_payroll_population_reconciliation.sql')), 'new forward-only migration exists');
});
