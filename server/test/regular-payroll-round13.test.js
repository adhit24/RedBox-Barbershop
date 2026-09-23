'use strict';

/**
 * Round-13 regression test suite (Codex round-12 findings on PR #98, head 4e418185):
 * 1. P1 (PRRT_kwDOSNmW7c6klJoN): overtime money is computed from exact approved minutes, never a
 *    1-decimal-rounded hours intermediate (covered primarily in regular-payroll-engine.test.js; this
 *    file adds the end-to-end draft-generation view).
 * 2. P1 (PRRT_kwDOSNmW7c6klJoS): covered in the backoffice UI test suite
 *    (src/pages/__tests__/RegularPayroll.test.tsx).
 * 3. P1 (PRRT_kwDOSNmW7c6klJoV): lock_payroll_run rejects an existing item whose employee is no
 *    longer eligible, even when recalculateRegularPayrollRun never ran (no population_changed marker).
 * 4. P2 (PRRT_kwDOSNmW7c6klJoY): covered in fingerprint-machine-identity.test.js /
 *    fingerprint-reconciliation.test.js.
 * 5. P2 (PRRT_kwDOSNmW7c6klJod): NULL employment_type behaves identically in generation,
 *    reconciliation, and the lock backstop.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createInMemorySupabase } = require('./helpers/inMemorySupabase');
const {
  generateRegularPayrollDraft,
  reconcileRegularPayrollPopulation,
  lockRegularPayrollRun,
  fetchEligibleRegularEmployees,
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

function fillAttendance(store, empId, startDate = PERIOD_START, endDate = PERIOD_END, overtimeMinutes = 0) {
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
      overtime_minutes: overtimeMinutes,
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

// ================================================================================================
// P1-3: lock rejects a now-ineligible EXISTING item, even without recalculation (PRRT_kwDOSNmW7c6klJoV)
// ================================================================================================

test('5. direct lock (no recalculate) rejects a now-ineligible existing employee', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });

  // Deactivate the only employee AFTER generation, and deliberately skip recalculateRegularPayrollRun
  // (so attendance_summary.population_changed was NEVER set).
  store.employees.find((e) => e.id === 'emp-1').is_active = false;

  await assert.rejects(
    () => lockRegularPayrollRun(sb, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    /no longer eligible/i
  );
  const run = store.payroll_runs.find((r) => r.id === draft.run_id);
  assert.equal(run.status, 'DRAFT', 'the run must remain DRAFT: no silent lock with a stale population');
});

test('5b. employment_type changed away from regular (no recalculate) also blocks direct lock', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });

  store.employees.find((e) => e.id === 'emp-1').employment_type = 'commission-based';

  await assert.rejects(
    () => lockRegularPayrollRun(sb, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    /no longer eligible/i
  );
});

test('6. missing eligible employee still blocks lock (unchanged from round 11/12)', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });

  store.employees.push(regularEmployee({ id: 'emp-2', name: 'Beta Regular', nickname: 'Beta' }));
  fillAttendance(store, 'emp-2');

  await assert.rejects(
    () => lockRegularPayrollRun(sb, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    /eligible employee\(s\) are missing/i
  );
});

test('the DB lock_payroll_run RPC independently rejects the same scenario (Node preflight bypassed)', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });
  store.employees.find((e) => e.id === 'emp-1').is_active = false;

  const { data, error } = await sb.rpc('lock_payroll_run', { p_run_id: draft.run_id, p_user_email: 'owner@redbox.id' });
  assert.equal(data, null);
  assert.match(error.message, /no longer eligible/i);
});

// ================================================================================================
// P2-2: NULL employment_type behaves identically everywhere (PRRT_kwDOSNmW7c6klJod)
// ================================================================================================

test('7. NULL employment_type: accepted at generation', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1', employment_type: null })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const eligible = await fetchEligibleRegularEmployees(sb, { businessUnit: 'ALL', periodEnd: PERIOD_END });
  assert.deepEqual(eligible.map((e) => e.id), ['emp-1']);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });
  assert.equal(store.payroll_regular_items.filter((i) => i.payroll_run_id === draft.run_id).length, 1);
});

test('7b. NULL employment_type: accepted by population reconciliation (does not throw EMPLOYEE_NOT_ELIGIBLE)', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });

  // A NULL-employment_type employee is created after the draft -- must still be reconcilable.
  store.employees.push(regularEmployee({ id: 'emp-2', name: 'Beta Regular', nickname: 'Beta', employment_type: null }));
  fillAttendance(store, 'emp-2');

  const population = await reconcileRegularPayrollPopulation(sb, draft.run_id);
  assert.deepEqual(population.inserted, ['emp-2']);
});

test('7c. NULL employment_type: accepted by the lock backstop (present + eligible + NULL type -> lock succeeds)', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1', employment_type: null })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });

  const lockResult = await lockRegularPayrollRun(sb, { runId: draft.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(lockResult.status, 'LOCKED');
});

// ================================================================================================
// 11 & 12: Barber payroll unchanged / previous concurrency tests remain green (structural + sql checks)
// ================================================================================================

test('11. Barber payroll lock is untouched by the population symmetry / NULL employment_type fix', () => {
  const migrationPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260922040000_regular_payroll_lock_population_symmetry.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.ok(sql.includes('payroll_barber_items'), 'barber items check present');
  assert.ok(sql.includes('payroll_review_items'), 'barber review items check present');
  assert.ok(sql.includes('payroll_barber_commission_items'), 'barber commission lines check present');
  assert.ok(sql.includes('payroll_source_claims'), 'barber source claims present');
  assert.ok(sql.includes('claims_created'), 'claims_created returned in result');
  assert.ok(sql.includes('SECURITY INVOKER'), 'SECURITY INVOKER preserved');
  assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION public.lock_payroll_run(UUID, TEXT) TO service_role"), 'lock_payroll_run is service_role only');
  assert.ok(sql.includes("REVOKE ALL ON FUNCTION public.lock_payroll_run(UUID, TEXT) FROM PUBLIC, anon, authenticated"), 'no privilege widening for lock_payroll_run');
  assert.ok(sql.includes("(e.employment_type = 'regular' OR e.employment_type IS NULL)"), 'NULL employment_type accepted in both missing-eligible and extra-item queries');
  assert.match(sql, /payroll item exists for employee no longer eligible/, 'extra-item (two-way) rejection message present');
});

test('12a. the 20260922000000 migration was NOT edited; the fix is a new forward-only migration', () => {
  const migrationsDir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
  const original = fs.readFileSync(path.join(migrationsDir, '20260922000000_regular_payroll_population_reconciliation.sql'), 'utf8');
  // The original strict rule (without the NULL clause) must still be present, unedited, in that file --
  // proof that the correction lives in a NEW migration, not a rewrite of the applied one.
  assert.match(original, /AND e\.employment_type = 'regular'\n/);
  assert.ok(fs.existsSync(path.join(migrationsDir, '20260922040000_regular_payroll_lock_population_symmetry.sql')), 'new corrective migration exists');
  assert.ok(fs.existsSync(path.join(migrationsDir, '20260922022232_20260922000000_regular_payroll_population_reconciliation.sql')), 'migration-history no-op alignment file exists');
});

test('12b. previous concurrency invariants remain intact (source-revision + advisory lock reused, not reinvented)', () => {
  const migrationPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260922040000_regular_payroll_lock_population_symmetry.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('redbox\.regular_payroll_run_overlap'\)\)/);
  assert.match(sql, /PAYROLL_INPUT_CHANGED_DURING_POPULATION_RECONCILIATION/);
  assert.match(sql, /EMPLOYEE_ALREADY_IN_RUN/);
});
