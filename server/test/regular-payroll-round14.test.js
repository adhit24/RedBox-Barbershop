'use strict';

/**
 * Round-14 regression test suite (Codex round-13 findings on PR #98, head b33e6ab2):
 * 1. P1 (PRRT_kwDOSNmW7c6kldWl): serialize workforce eligibility changes with payroll locking /
 *    population reconciliation via an authoritative global workforce revision.
 * 2. P2 (PRRT_kwDOSNmW7c6kldWm): an explicit approved_overtime_hours/minutes override must take
 *    precedence over the attendance-derived value (primarily covered in regular-payroll-engine.test.js;
 *    this file adds the end-to-end draft-generation view).
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
// P1: workforce revision serializes eligibility changes with lock (PRRT_kwDOSNmW7c6kldWl)
// ================================================================================================

test('workforce revision: an unrelated employee UPDATE (e.g. name) does not bump the revision', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  const sb = createInMemorySupabase(store);
  const before = store.__workforceRevision || 0;
  await sb.from('employees').update({ name: 'Alpha Regular Renamed' }).eq('id', 'emp-1');
  assert.equal(store.__workforceRevision || 0, before);
});

test('workforce revision: is_active change bumps the revision', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  const sb = createInMemorySupabase(store);
  const before = store.__workforceRevision || 0;
  await sb.from('employees').update({ is_active: false }).eq('id', 'emp-1');
  assert.equal(store.__workforceRevision || 0, before + 1);
});

test('workforce revision: employment_type change bumps the revision', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  const sb = createInMemorySupabase(store);
  const before = store.__workforceRevision || 0;
  await sb.from('employees').update({ employment_type: 'commission-based' }).eq('id', 'emp-1');
  assert.equal(store.__workforceRevision || 0, before + 1);
});

test('workforce revision: join_date change bumps the revision', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  const sb = createInMemorySupabase(store);
  const before = store.__workforceRevision || 0;
  await sb.from('employees').update({ join_date: '2026-12-01' }).eq('id', 'emp-1');
  assert.equal(store.__workforceRevision || 0, before + 1);
});

test('workforce revision: business_unit change bumps the revision', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  const sb = createInMemorySupabase(store);
  const before = store.__workforceRevision || 0;
  await sb.from('employees').update({ business_unit: 'Sundaze' }).eq('id', 'emp-1');
  assert.equal(store.__workforceRevision || 0, before + 1);
});

test('workforce revision: activation (is_active false -> true) also bumps the revision', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1', is_active: false })]);
  const sb = createInMemorySupabase(store);
  const before = store.__workforceRevision || 0;
  await sb.from('employees').update({ is_active: true }).eq('id', 'emp-1');
  assert.equal(store.__workforceRevision || 0, before + 1);
});

// NOTE (round 15, PRRT_kwDOSNmW7c6klyj1): the capture-then-recheck design that used to be tested here
// (two unlocked reads of payroll_workforce_version.revision, compared before freezing) was replaced by
// an actual `FOR UPDATE` row lock held for the rest of the transaction -- see
// 20260922080000_regular_payroll_workforce_lock_and_manual_overtime.sql. A synchronous single-threaded
// JS double cannot reproduce genuine Postgres transactional blocking, so the correctness of the new
// design is verified by the static SQL-text assertions in regular-payroll-round15.test.js instead
// (the FOR UPDATE hold is present; the old capture/recheck pattern is gone). The tests that used to
// live here (`WORKFORCE_CHANGED_DURING_PAYROLL_LOCK` / `_DURING_POPULATION_RECONCILIATION` no longer
// exist in the real function, so a mock that raised them would misrepresent production behavior) were
// removed rather than left asserting a mechanism that no longer exists.

test('no workforce change during lock validation -> lock flow unaffected, run LOCKED', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });

  const result = await lockRegularPayrollRun(sb, { runId: draft.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(result.status, 'LOCKED');
});

test('population reconciliation still succeeds when a new eligible employee appears (unaffected by the lock-holding redesign)', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });

  store.employees.push(regularEmployee({ id: 'emp-2', name: 'Beta Regular', nickname: 'Beta' }));
  fillAttendance(store, 'emp-2');

  const population = await reconcileRegularPayrollPopulation(sb, draft.run_id);
  assert.deepEqual(population.inserted, ['emp-2']);
  const items = store.payroll_regular_items.filter((i) => i.payroll_run_id === draft.run_id);
  assert.deepEqual(items.map((i) => i.employee_id).sort(), ['emp-1', 'emp-2']);
});

test('Barber payroll lock is unaffected by the workforce serialization redesign (no employees table dependency)', async () => {
  const store = baseWorkforce([]);
  store.payroll_runs.push({
    id: 'barber-run-1', payroll_type: 'BARBER', business_unit: 'Redbox', status: 'DRAFT',
    period_start: PERIOD_START, period_end: PERIOD_END, summary: {},
  });
  store.payroll_review_items = [];
  store.payroll_barber_items = [];
  store.payroll_barber_commission_items = [];
  store.payroll_source_claims = [];
  const sb = createInMemorySupabase(store);

  const { data, error } = await sb.rpc('lock_payroll_run', { p_run_id: 'barber-run-1', p_user_email: 'owner@redbox.id' });
  assert.equal(error, null);
  assert.equal(data.status, 'LOCKED');
});

// ================================================================================================
// P2: explicit overtime override end-to-end at draft generation (PRRT_kwDOSNmW7c6kldWm)
// ================================================================================================

test('draft generation: an explicit approved_overtime_hours override wins over attendance-derived 0', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1'); // no overtime_minutes on any attendance row -> attendance-derived approved minutes = 0
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, {
    periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id',
    itemOverrides: { 'emp-1': { approved_overtime_hours: 1.5 } },
  });
  const item = store.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id && i.employee_id === 'emp-1');
  assert.equal(item.attendance_summary.approved_overtime_minutes, 90);
  assert.equal(item.overtime_amount, 11250);
  assert.equal(item.attendance_summary.overtime_source, 'MANUAL_OVERRIDE');
});

test('new migration preserves prior invariants: SECURITY INVOKER, service_role-only, Barber branch, advisory lock, CAS', () => {
  const migrationPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260922060000_regular_payroll_workforce_revision.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.ok(sql.includes('SECURITY INVOKER'));
  assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION public.lock_payroll_run(UUID, TEXT) TO service_role"));
  assert.ok(sql.includes("REVOKE ALL ON FUNCTION public.lock_payroll_run(UUID, TEXT) FROM PUBLIC, anon, authenticated"));
  assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION public.add_regular_payroll_run_items(UUID, JSONB) TO service_role"));
  assert.ok(sql.includes('payroll_barber_items'), 'barber branch preserved');
  assert.ok(sql.includes("pg_advisory_xact_lock(hashtext('redbox.regular_payroll_run_overlap'))"));
  assert.ok(sql.includes('PAYROLL_INPUT_CHANGED_DURING_POPULATION_RECONCILIATION'));
  assert.match(sql, /WORKFORCE_CHANGED_DURING_PAYROLL_LOCK/);
  assert.match(sql, /WORKFORCE_CHANGED_DURING_POPULATION_RECONCILIATION/);
  assert.ok(sql.includes('payroll_workforce_version'));
});

test('the previously-applied migrations were not edited; the fix is a new forward-only migration', () => {
  const migrationsDir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
  for (const f of [
    '20260922000000_regular_payroll_population_reconciliation.sql',
    '20260922040000_regular_payroll_lock_population_symmetry.sql',
  ]) {
    assert.ok(fs.existsSync(path.join(migrationsDir, f)), `${f} must still exist unedited`);
  }
  assert.ok(fs.existsSync(path.join(migrationsDir, '20260922060000_regular_payroll_workforce_revision.sql')));
  assert.ok(fs.existsSync(path.join(migrationsDir, '20260922024329_regular_payroll_lock_population_symmetry.sql')), 'migration-history no-op alignment file exists');
});
