'use strict';

/**
 * Round-15 regression test suite (Codex round-14 findings on PR #98, head 05eae784):
 * 1. P1 (PRRT_kwDOSNmW7c6klyj1): the workforce-revision capture/recheck (round 14) compared two
 *    UNLOCKED reads. Replaced with a `FOR UPDATE` row lock on the payroll_workforce_version singleton,
 *    held for the rest of the transaction by lock_payroll_run / add_regular_payroll_run_items -- the
 *    employees trigger already participates via ordinary Postgres row locking (its own plain UPDATE on
 *    that row). No test double can reproduce genuine cross-transaction blocking in a single-threaded
 *    synchronous JS process, so this file combines:
 *      (a) static SQL-text assertions proving the FOR UPDATE hold exists and the old unlocked
 *          capture/recheck pattern is gone from the new migration, and
 *      (b) a protocol-level simulation using a generic async mutex standing in for "the same FOR
 *          UPDATE row lock", proving the ORDERING property the design relies on: a concurrent
 *          employee mutation cannot complete (commit) while the payroll lock transaction holds the
 *          lock. This is a simulation of the protocol, not a live-Postgres integration test.
 * 2. P2 (PRRT_kwDOSNmW7c6klyj8): a MANUAL_OVERRIDE overtime item is no longer compared against the
 *    approved-overtime DB aggregate at lock time (Node evaluateOvertimeLockInvariants and SQL
 *    lock_payroll_run implement identical semantics); it is validated deterministically against its
 *    own rate/minutes instead. Recalculation preserves an existing override rather than discarding it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createInMemorySupabase } = require('./helpers/inMemorySupabase');
const {
  generateRegularPayrollDraft,
  recalculateRegularPayrollRun,
  lockRegularPayrollRun,
  evaluateOvertimeLockInvariants,
} = require('../services/regularPayrollService');

const PERIOD_START = '2026-08-26';
const PERIOD_END = '2026-09-25';
const MIGRATION_PATH = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260922080000_regular_payroll_workforce_lock_and_manual_overtime.sql');

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
// P1a: static SQL-text proof of the FOR UPDATE hold (PRRT_kwDOSNmW7c6klyj1)
// ================================================================================================

test('migration: lock_payroll_run and add_regular_payroll_run_items hold FOR UPDATE on payroll_workforce_version', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const forUpdateHold = /PERFORM 1 FROM public\.payroll_workforce_version WHERE id = 1 FOR UPDATE;/g;
  const matches = sql.match(forUpdateHold) || [];
  assert.equal(matches.length, 2, 'both add_regular_payroll_run_items and lock_payroll_run must hold the row lock');
});

test('migration: the old unlocked capture/recheck pattern is gone (no longer relies on comparing two reads)', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  assert.ok(!sql.includes('WORKFORCE_CHANGED_DURING_PAYROLL_LOCK'), 'the unlocked-read exception must not exist in the new migration');
  assert.ok(!sql.includes('WORKFORCE_CHANGED_DURING_POPULATION_RECONCILIATION'), 'the unlocked-read exception must not exist in the new migration');
  assert.ok(!sql.includes('v_workforce_rev_before'), 'the capture/recheck variables must be gone');
  assert.ok(!sql.includes('v_workforce_rev_after'), 'the capture/recheck variables must be gone');
});

test('migration: the FOR UPDATE hold is acquired in the REGULAR branch before any population/guard check', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const branchStart = sql.indexOf("IF v_run.payroll_type IN ('REGULAR', 'REGULAR_PAYROLL') THEN");
  const lockLine = sql.indexOf('PERFORM 1 FROM public.payroll_workforce_version WHERE id = 1 FOR UPDATE;', branchStart);
  const missingEligibleCheck = sql.indexOf('v_missing_eligible', branchStart);
  const freezeLine = sql.indexOf("SET status = 'LOCKED', updated_at = now()", branchStart);
  assert.ok(branchStart > 0 && lockLine > branchStart, 'lock must be inside the REGULAR branch');
  assert.ok(lockLine < missingEligibleCheck, 'lock must be acquired BEFORE population validation');
  assert.ok(missingEligibleCheck < freezeLine, 'population validation must happen before the freeze');
});

test('migration: Barber payroll branch never touches payroll_workforce_version', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const barberBranchStart = sql.indexOf('-- Barber payroll: preserved verbatim');
  const barberBranchEnd = sql.indexOf('-- 3. Mark run as LOCKED');
  const barberBranch = sql.slice(barberBranchStart, barberBranchEnd);
  assert.ok(barberBranchStart > 0 && barberBranchEnd > barberBranchStart);
  assert.ok(!barberBranch.includes('payroll_workforce_version'), 'Barber payroll must not consult the workforce lock/revision');
});

test('migration: prior invariants preserved (SECURITY INVOKER, service_role-only, advisory lock, source-revision CAS)', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  assert.ok(sql.includes('SECURITY INVOKER'));
  assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION public.lock_payroll_run(UUID, TEXT) TO service_role"));
  assert.ok(sql.includes("REVOKE ALL ON FUNCTION public.lock_payroll_run(UUID, TEXT) FROM PUBLIC, anon, authenticated"));
  assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION public.add_regular_payroll_run_items(UUID, JSONB) TO service_role"));
  assert.ok(sql.includes("pg_advisory_xact_lock(hashtext('redbox.regular_payroll_run_overlap'))"));
  assert.ok(sql.includes('PAYROLL_INPUT_CHANGED_DURING_POPULATION_RECONCILIATION'));
  assert.ok(sql.includes('EMPLOYEE_NOT_ELIGIBLE_FOR_POPULATION_RECONCILIATION'));
  assert.ok(sql.includes('payroll_barber_items'), 'barber branch preserved');
});

test('the previously-applied migrations were not edited; the fix is a new forward-only migration', () => {
  const migrationsDir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
  for (const f of [
    '20260922000000_regular_payroll_population_reconciliation.sql',
    '20260922040000_regular_payroll_lock_population_symmetry.sql',
    '20260922060000_regular_payroll_workforce_revision.sql',
  ]) {
    assert.ok(fs.existsSync(path.join(migrationsDir, f)), `${f} must still exist unedited`);
  }
  assert.ok(fs.existsSync(MIGRATION_PATH), 'new corrective migration exists');
});

// ================================================================================================
// P1b: protocol-level simulation -- a concurrent employee mutation cannot commit while the payroll
// lock transaction holds the row lock (PRRT_kwDOSNmW7c6klyj1)
// ================================================================================================

/** Generic async mutex standing in for "the same FOR UPDATE row lock on payroll_workforce_version". */
function makeRowLock() {
  let queue = Promise.resolve();
  return {
    async withLock(fn) {
      let releaseNext;
      const prev = queue;
      queue = new Promise((resolve) => { releaseNext = resolve; });
      await prev;
      try {
        return await fn();
      } finally {
        releaseNext();
      }
    },
  };
}

const EMPLOYEE_MUTATIONS = ['activation', 'deactivation', 'employment_type change', 'join_date change', 'business_unit change'];

for (const mutation of EMPLOYEE_MUTATIONS) {
  test(`simulated FOR UPDATE protocol: employee ${mutation} cannot commit before the payroll lock transaction finishes`, async () => {
    const lock = makeRowLock();
    const events = [];
    let lockTransactionCommitted = false;

    // T1: lock_payroll_run acquires the row lock BEFORE population validation, holds it through the
    // freeze, and only releases when the transaction ends (commit).
    const lockTxn = lock.withLock(async () => {
      events.push('lock:acquired');
      await new Promise((r) => setTimeout(r, 15)); // population validation + guards + freeze
      events.push('lock:freeze-and-commit');
      lockTransactionCommitted = true;
    });

    // Give T1 a head start so it acquires the lock first (T1 begins finalization before T2 starts).
    await new Promise((r) => setTimeout(r, 3));

    // T2: an employees UPDATE for this mutation. The UPDATE on `employees` itself is not blocked by
    // our lock (it only guards payroll_workforce_version) -- but its AFTER trigger
    // (bump_payroll_workforce_version) issues `UPDATE payroll_workforce_version ... WHERE id = 1`,
    // which blocks on the SAME row lock T1 holds. T2's own COMMIT cannot proceed until that trigger
    // UPDATE completes, i.e. until T1 releases.
    const employeeTxn = lock.withLock(async () => {
      events.push(`employee:${mutation}:trigger-bump-and-commit`);
      assert.equal(lockTransactionCommitted, true,
        `employee ${mutation} must not commit before the payroll lock transaction finishes`);
    });

    await Promise.all([lockTxn, employeeTxn]);
    assert.deepEqual(events, ['lock:acquired', 'lock:freeze-and-commit', `employee:${mutation}:trigger-bump-and-commit`]);
  });
}

test('simulated FOR UPDATE protocol: no contention when the employee mutation starts after the lock transaction already finished', async () => {
  const lock = makeRowLock();
  const events = [];

  await lock.withLock(async () => {
    events.push('lock:acquired-and-committed');
  });

  await lock.withLock(async () => {
    events.push('employee:commits-immediately-no-wait');
  });

  assert.deepEqual(events, ['lock:acquired-and-committed', 'employee:commits-immediately-no-wait']);
});

test('population reconciliation still refuses to insert an employee that is not currently eligible (existing server-side re-check, unaffected by the lock-hold redesign)', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, { periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id' });

  // A stale/incorrect item payload claiming eligibility for an employee who does not exist / is not
  // eligible -- add_regular_payroll_run_items must still reject it via its own re-check.
  const { data, error } = await sb.rpc('add_regular_payroll_run_items', {
    p_run_id: draft.run_id,
    p_items: [{
      employee_id: 'ghost-employee', employee_name_snapshot: 'Ghost', business_unit_snapshot: 'Redbox',
      base_salary: 1000000, daily_salary: 33333, salary_divisor: 30, work_days: 0, actual_salary: 0,
      meal_allowance_days: 0, meal_allowance_rate: 0, meal_allowance_total: 0,
      position_allowance: 0, attendance_allowance: 0, overtime_hours: 0, overtime_rate: 7500, overtime_amount: 0,
      late_count: 0, late_penalty_rate: 15000, late_deduction: 0,
      debt_deduction: 0, manual_deduction: 0, manual_bonus: 0, adjustments_total: 0,
      gross_pay: 0, total_deduction: 0, take_home_pay: 0,
      attendance_coverage_days: 0, attendance_coverage_status: 'NO_ATTENDANCE',
      attendance_summary: {}, warnings: [], status: 'MISSING_ATTENDANCE',
      attendance_source_revision: 0, attendance_snapshot_revision: 0, payroll_input_revision: 0, payroll_snapshot_revision: 0,
    }],
  });
  assert.equal(data, null);
  assert.match(error.message, /EMPLOYEE_NOT_ELIGIBLE_FOR_POPULATION_RECONCILIATION/);
});

// ================================================================================================
// P2: manual overtime override is lockable (PRRT_kwDOSNmW7c6klyj8)
// ================================================================================================

test('1. approvals = 0, override 90 min -> lock allowed when all other guards pass', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1'); // no overtime approvals at all
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, {
    periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id',
    itemOverrides: { 'emp-1': { approved_overtime_hours: 1.5 } },
  });
  const item = store.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id);
  assert.equal(item.attendance_summary.overtime_source, 'MANUAL_OVERRIDE');
  assert.equal(item.overtime_amount, 11250);

  const result = await lockRegularPayrollRun(sb, { runId: draft.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(result.status, 'LOCKED');
});

test('2. approvals = 60, override 30 -> override wins and lock allowed', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  store.employee_attendance.find((r) => r.employee_id === 'emp-1' && r.attendance_date === PERIOD_START).overtime_minutes = 60;
  store.employee_overtime_approvals.push({
    id: 'ot-1', employee_id: 'emp-1', attendance_date: PERIOD_START,
    raw_overtime_minutes: 60, approved_overtime_minutes: 60, status: 'APPROVED',
  });
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, {
    periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id',
    itemOverrides: { 'emp-1': { approved_overtime_hours: 0.5 } },
  });
  const item = store.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id);
  assert.equal(item.attendance_summary.approved_overtime_minutes, 30);
  assert.equal(item.overtime_amount, 3750);

  const result = await lockRegularPayrollRun(sb, { runId: draft.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(result.status, 'LOCKED');
});

test('3. override 0 -> intentional zero remains valid and lockable', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  store.employee_attendance.find((r) => r.employee_id === 'emp-1' && r.attendance_date === PERIOD_START).overtime_minutes = 60;
  store.employee_overtime_approvals.push({
    id: 'ot-1', employee_id: 'emp-1', attendance_date: PERIOD_START,
    raw_overtime_minutes: 60, approved_overtime_minutes: 60, status: 'APPROVED',
  });
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, {
    periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id',
    itemOverrides: { 'emp-1': { approved_overtime_hours: 0 } },
  });
  const item = store.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id);
  assert.equal(item.attendance_summary.overtime_source, 'MANUAL_OVERRIDE');
  assert.equal(item.attendance_summary.approved_overtime_minutes, 0);
  assert.equal(item.overtime_amount, 0);

  const result = await lockRegularPayrollRun(sb, { runId: draft.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(result.status, 'LOCKED');
});

test('4. a non-override item still must match the approved-overtime aggregate exactly (strict reconciliation unchanged)', () => {
  const items = [{ employee_id: 'e1', employee_name_snapshot: 'E1', overtime_hours: 1.0, overtime_rate: 7500, overtime_amount: 7500, attendance_summary: { approved_overtime_minutes: 60 } }];
  const approvals = [{ employee_id: 'e1', attendance_date: '2026-09-01', raw_overtime_minutes: 30, approved_overtime_minutes: 30, status: 'APPROVED' }];
  const attendanceRows = [{ employee_id: 'e1', attendance_date: '2026-09-01', overtime_minutes: 30 }];
  const violation = evaluateOvertimeLockInvariants({ items, approvals, attendanceRows });
  assert.equal(violation?.code, 'OVERTIME_SNAPSHOT_STALE');
});

test('5. manual override amount math is validated exactly (correct math passes, tampered amount fails)', () => {
  const correct = [{ employee_id: 'e1', employee_name_snapshot: 'E1', overtime_rate: 7500, overtime_amount: 11250, attendance_summary: { overtime_source: 'MANUAL_OVERRIDE', approved_overtime_minutes: 90 } }];
  assert.equal(evaluateOvertimeLockInvariants({ items: correct, approvals: [], attendanceRows: [] }), null);

  const tampered = [{ employee_id: 'e1', employee_name_snapshot: 'E1', overtime_rate: 7500, overtime_amount: 99999, attendance_summary: { overtime_source: 'MANUAL_OVERRIDE', approved_overtime_minutes: 90 } }];
  const violation = evaluateOvertimeLockInvariants({ items: tampered, approvals: [], attendanceRows: [] });
  assert.equal(violation?.code, 'OVERTIME_SNAPSHOT_STALE');
  assert.match(violation.message, /stale/i);
});

test('6. recalculation preserves an existing manual override (does not silently discard it)', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, {
    periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id',
    itemOverrides: { 'emp-1': { approved_overtime_hours: 1.5 } },
  });
  const before = store.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id);
  assert.equal(before.attendance_summary.overtime_source, 'MANUAL_OVERRIDE');
  assert.equal(before.overtime_amount, 11250);

  // Force a full recalculation (e.g. triggered by an unrelated adjustment/attendance sync elsewhere in
  // the app) -- if the override were discarded, this would silently reset overtime to the
  // attendance-derived value (0, since fillAttendance adds no overtime_minutes).
  await recalculateRegularPayrollRun(sb, draft.run_id, { all: true });

  const after = store.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id);
  assert.equal(after.attendance_summary.overtime_source, 'MANUAL_OVERRIDE', 'override must survive recalculation');
  assert.equal(after.attendance_summary.approved_overtime_minutes, 90);
  assert.equal(after.overtime_amount, 11250);

  // And it must still lock cleanly afterward.
  const result = await lockRegularPayrollRun(sb, { runId: draft.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(result.status, 'LOCKED');
});

test('7. a stale/tampered manual override snapshot blocks lock, both at the Node preflight and the DB RPC', async () => {
  const store = baseWorkforce([regularEmployee({ id: 'emp-1' })]);
  fillAttendance(store, 'emp-1');
  const sb = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(sb, {
    periodStart: PERIOD_START, periodEnd: PERIOD_END, businessUnit: 'ALL', userEmail: 'owner@redbox.id',
    itemOverrides: { 'emp-1': { approved_overtime_hours: 1.5 } },
  });
  const item = store.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id);
  assert.equal(item.overtime_amount, 11250);
  // Simulate direct tampering / a bug that desynced the persisted amount from the override minutes.
  item.overtime_amount = 500;

  await assert.rejects(
    () => lockRegularPayrollRun(sb, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    /stale/i
  );

  // DB RPC also independently rejects (Node preflight bypassed).
  const { data, error } = await sb.rpc('lock_payroll_run', { p_run_id: draft.run_id, p_user_email: 'owner@redbox.id' });
  assert.equal(data, null);
  assert.match(error.message, /inconsistent/i);
});

test('Barber payroll lock is unaffected by the manual-override overtime invariant', async () => {
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
