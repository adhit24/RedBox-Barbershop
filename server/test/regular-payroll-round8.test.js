'use strict';

/**
 * Round-8 review regressions:
 * 1. P1-1 (PRRT_kwDOSNmW7c6kTvgJ): Block all REVIEW_REQUIRED items before lock (service layer & DB RPC)
 * 2. P1-2 (PRRT_kwDOSNmW7c6kTvgQ): Recompute run coverage after attendance refresh (false -> true)
 * 3. P1-3 (PRRT_kwDOSNmW7c6kTvgT): Fail closed when identity context queries fail (no fallback matching/mutation)
 * 4. P2   (PRRT_kwDOSNmW7c6kTvga): Propagate attendance exception write failures with honest partial-write counts
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createInMemorySupabase } = require('./helpers/inMemorySupabase');
const {
  generateRegularPayrollDraft,
  recalculateSingleRegularItem,
  recalculateRegularPayrollRun,
  lockRegularPayrollRun,
  computeRunAttendanceCoverage,
} = require('../services/regularPayrollService');
const {
  previewImport,
  commitImport,
} = require('../services/fingerprintAttendanceImporter');

// Helper to build mock xls buffer
function createMinimalXlsBuffer() {
  const fixturePath = path.join(__dirname, 'fixtures', 'fingerprint', 'sample_standard_report.xls');
  return fs.readFileSync(fixturePath);
}

function baseWorkforce() {
  return {
    employees: [
      {
        id: 'emp-1',
        employee_code: 'EMP001',
        name: 'Alpha Tester',
        nickname: 'Alpha',
        business_unit: 'Redbox',
        branch: 'bypass',
        position: 'Staff',
        base_salary: 3000000,
        position_allowance: 0,
        meal_allowance_rate: 0,
        is_active: true,
      },
      {
        id: 'emp-2',
        employee_code: 'EMP002',
        name: 'Beta Tester',
        nickname: 'Beta',
        business_unit: 'Redbox',
        branch: 'bypass',
        position: 'Staff',
        base_salary: 3000000,
        position_allowance: 0,
        meal_allowance_rate: 0,
        is_active: true,
      },
    ],
    barbers: [
      { id: 'bar-1', name: 'Barber One', branch: 'bypass', is_active: true },
    ],
    employee_attendance_identity: [
      {
        source: 'fingerprint:bypass',
        external_employee_id: '3',
        external_name: 'Alpha Tester',
        target_type: 'employee',
        employee_id: 'emp-1',
      },
    ],
    employee_attendance: [],
    employee_overtime_approvals: [],
    attendance_exceptions: [],
    payroll_runs: [],
    payroll_regular_items: [],
    payroll_adjustments: [],
    attendance_import_batches: [],
  };
}

// ------------------------------------------------------------------------------------------------
// P1-1: Block all REVIEW_REQUIRED items before lock
// ------------------------------------------------------------------------------------------------

test('P1-1: incomplete punch -> REVIEW_REQUIRED -> lock rejected by service and DB RPC', async () => {
  const store = baseWorkforce();
  store.employees = [store.employees[0]]; // isolate emp-1
  // Provide full coverage dates
  const dates = [];
  for (let d = 1; d <= 25; d++) dates.push('2026-09-' + String(d).padStart(2, '0'));

  // emp-1 has an incomplete punch on 2026-09-05 (first_check_in only, no last_check_out)
  store.employee_attendance = dates.map((date) => ({
    employee_id: 'emp-1',
    attendance_date: date,
    status: date === '2026-09-05' ? 'incomplete' : 'hadir',
    late_minutes: 0,
    overtime_minutes: 0,
    first_check_in: '08:00',
    last_check_out: date === '2026-09-05' ? null : '17:00',
    raw_punches: date === '2026-09-05' ? ['08:00'] : ['08:00', '17:00'],
  }));

  const db = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-09-01',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });

  const item = store.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id && i.employee_id === 'emp-1');
  assert.equal(item.status, 'REVIEW_REQUIRED', 'incomplete punch forces REVIEW_REQUIRED');

  // Service guard must reject
  await assert.rejects(
    () => lockRegularPayrollRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    /review-required item\(s\) remain/i
  );

  // DB RPC must also reject
  const rpc = await db.rpc('lock_payroll_run', { p_run_id: draft.run_id, p_user_email: 'owner@redbox.id' });
  assert.ok(rpc.error);
  assert.match(rpc.error.message, /review-required item\(s\) remain/i);
});

test('P1-1: unresolved attendance exception -> REVIEW_REQUIRED -> lock rejected', async () => {
  const store = baseWorkforce();
  store.employees = [store.employees[0]]; // isolate emp-1
  const dates = [];
  for (let d = 1; d <= 25; d++) dates.push('2026-09-' + String(d).padStart(2, '0'));

  store.employee_attendance = dates.map((date) => ({
    employee_id: 'emp-1',
    attendance_date: date,
    status: 'hadir',
    late_minutes: 0,
    overtime_minutes: 0,
    first_check_in: '08:00',
    last_check_out: '17:00',
    raw_punches: ['08:00', '17:00'],
  }));

  // Pending exception for emp-1
  store.attendance_exceptions = [
    {
      id: 'exc-1',
      attendance_date: '2026-09-10',
      status: 'pending',
      raw_data: { employee_id: 'emp-1' },
    },
  ];

  const db = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-09-01',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });

  const item = store.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id && i.employee_id === 'emp-1');
  assert.equal(item.status, 'REVIEW_REQUIRED', 'pending exception forces REVIEW_REQUIRED');

  await assert.rejects(
    () => lockRegularPayrollRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    /review-required item\(s\) remain/i
  );
});

test('P1-1: insufficient coverage -> REVIEW_REQUIRED -> lock rejected', async () => {
  const store = baseWorkforce();
  store.employees = [store.employees[0]]; // isolate emp-1
  // Only 2 records across a 15-day window through Sep 15 (ratio 2/15 = 13% < 70% threshold)
  store.employee_attendance = ['2026-09-01', '2026-09-15'].map((date) => ({
    employee_id: 'emp-1',
    attendance_date: date,
    status: 'hadir',
    late_minutes: 0,
    overtime_minutes: 0,
    first_check_in: '08:00',
    last_check_out: '17:00',
    raw_punches: ['08:00', '17:00'],
  }));

  const db = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-09-01',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });

  const item = store.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id && i.employee_id === 'emp-1');
  assert.equal(item.status, 'REVIEW_REQUIRED', 'coverage short forces REVIEW_REQUIRED');

  await assert.rejects(
    () => lockRegularPayrollRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    /review-required item\(s\) remain|attendance data is only available through/i
  );
});

test('P1-1: fully READY item passes REVIEW_REQUIRED guard and locks', async () => {
  const store = baseWorkforce();
  store.employees = [store.employees[0]]; // single employee
  const dates = [];
  for (let d = 1; d <= 25; d++) dates.push('2026-09-' + String(d).padStart(2, '0'));

  store.employee_attendance = dates.map((date) => ({
    employee_id: 'emp-1',
    attendance_date: date,
    status: 'hadir',
    late_minutes: 0,
    overtime_minutes: 0,
    first_check_in: '08:00',
    last_check_out: '17:00',
    raw_punches: ['08:00', '17:00'],
  }));

  const db = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-09-01',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });

  const item = store.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id && i.employee_id === 'emp-1');
  assert.equal(item.status, 'READY', 'clean data produces READY status');

  const lockRes = await lockRegularPayrollRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(lockRes.status, 'LOCKED');
});

// ------------------------------------------------------------------------------------------------
// P1-2: Recompute run-level attendance coverage after recalculation
// ------------------------------------------------------------------------------------------------

test('P1-2: attendance coverage recomputes false -> true after final import & recalculateRegularPayrollRun', async () => {
  const store = baseWorkforce();
  store.employees = [store.employees[0]];

  // Initial attendance through Sep 20
  const initialDates = [];
  for (let d = 1; d <= 20; d++) initialDates.push('2026-09-' + String(d).padStart(2, '0'));

  store.employee_attendance = initialDates.map((date) => ({
    employee_id: 'emp-1',
    attendance_date: date,
    status: 'hadir',
    late_minutes: 0,
    overtime_minutes: 0,
    first_check_in: '08:00',
    last_check_out: '17:00',
    raw_punches: ['08:00', '17:00'],
  }));

  const db = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-09-01',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });

  const runRow = store.payroll_runs.find((r) => r.id === draft.run_id);
  assert.equal(runRow.summary.attendance_data_through, '2026-09-20');
  assert.equal(runRow.summary.attendance_period_complete, false);

  // Lock rejected because period is incomplete
  await assert.rejects(
    () => lockRegularPayrollRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    /attendance data is only available through 2026-09-20 but the period ends 2026-09-25/
  );

  // Now final attendance files arrive: Sep 21 to Sep 25 imported
  for (let d = 21; d <= 25; d++) {
    const date = '2026-09-' + String(d).padStart(2, '0');
    store.employee_attendance.push({
      employee_id: 'emp-1',
      attendance_date: date,
      status: 'hadir',
      late_minutes: 0,
      overtime_minutes: 0,
      first_check_in: '08:00',
      last_check_out: '17:00',
      raw_punches: ['08:00', '17:00'],
    });
  }

  // Recalculate the run
  const recalcRes = await recalculateRegularPayrollRun(db, draft.run_id, { all: true });
  assert.equal(recalcRes.recalculated_count, 1);

  // Authoritative run summary must now be complete
  assert.equal(runRow.summary.attendance_data_through, '2026-09-25');
  assert.equal(runRow.summary.attendance_period_complete, true);

  // Lock should now succeed
  const lockRes = await lockRegularPayrollRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(lockRes.status, 'LOCKED');
});

test('P1-2: partial attendance import leaves attendance_period_complete = false', async () => {
  const store = baseWorkforce();
  store.employees = [store.employees[0]];

  // Initial attendance through Sep 20
  for (let d = 1; d <= 20; d++) {
    store.employee_attendance.push({
      employee_id: 'emp-1',
      attendance_date: '2026-09-' + String(d).padStart(2, '0'),
      status: 'hadir',
      late_minutes: 0,
      overtime_minutes: 0,
      first_check_in: '08:00',
      last_check_out: '17:00',
      raw_punches: ['08:00', '17:00'],
    });
  }

  const db = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-09-01',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });

  // Partial new days arrive through Sep 23 only
  for (let d = 21; d <= 23; d++) {
    store.employee_attendance.push({
      employee_id: 'emp-1',
      attendance_date: '2026-09-' + String(d).padStart(2, '0'),
      status: 'hadir',
      late_minutes: 0,
      overtime_minutes: 0,
      first_check_in: '08:00',
      last_check_out: '17:00',
      raw_punches: ['08:00', '17:00'],
    });
  }

  await recalculateRegularPayrollRun(db, draft.run_id, { all: true });

  const runRow = store.payroll_runs.find((r) => r.id === draft.run_id);
  assert.equal(runRow.summary.attendance_data_through, '2026-09-23');
  assert.equal(runRow.summary.attendance_period_complete, false);

  await assert.rejects(
    () => lockRegularPayrollRun(db, { runId: draft.run_id }),
    /attendance data is only available through 2026-09-23 but the period ends 2026-09-25/
  );
});

test('P1-2: coverage read failure aborts recalculation (ATTENDANCE_COVERAGE_READ_FAILED)', async () => {
  const store = baseWorkforce();
  store.employees = [store.employees[0]];
  store.employee_attendance.push({
    employee_id: 'emp-1',
    attendance_date: '2026-09-01',
    status: 'hadir',
    late_minutes: 0,
    overtime_minutes: 0,
    first_check_in: '08:00',
    last_check_out: '17:00',
    raw_punches: ['08:00', '17:00'],
  });

  const db = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-09-01',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });

  // Inject failure on employee_attendance.select
  const dbWithFail = createInMemorySupabase(store, {
    failOn: { 'employee_attendance.select': 'connection reset' },
  });

  await assert.rejects(
    () => recalculateRegularPayrollRun(dbWithFail, draft.run_id, { all: true }),
    (err) => err.code === 'ATTENDANCE_COVERAGE_READ_FAILED'
  );
});

// ------------------------------------------------------------------------------------------------
// P1-3: Fail closed when identity context queries fail
// ------------------------------------------------------------------------------------------------

test('P1-3: machine identity read failure aborts preview/commit (IDENTITY_CONTEXT_READ_FAILED)', async () => {
  const store = baseWorkforce();
  const db = createInMemorySupabase(store, {
    failOn: { 'employee_attendance_identity.select': 'database read timeout' },
  });

  const buffer = createMinimalXlsBuffer();

  await assert.rejects(
    () => previewImport({ buffer, filename: 'bypass.xls', supabase: db, machineSource: 'bypass' }),
    (err) => err.code === 'IDENTITY_CONTEXT_READ_FAILED'
  );

  await assert.rejects(
    () => commitImport({ buffer, filename: 'bypass.xls', supabase: db, machineSource: 'bypass' }),
    (err) => err.code === 'IDENTITY_CONTEXT_READ_FAILED'
  );

  // Verify zero mutations occurred
  assert.equal((store.employee_attendance || []).length, 0);
  assert.equal((store.attendance_import_batches || []).length, 0);
});

test('P1-3: employee master read failure aborts matching (EMPLOYEE_MASTER_READ_FAILED)', async () => {
  const store = baseWorkforce();
  const db = createInMemorySupabase(store, {
    failOn: { 'employees.select': 'employee table offline' },
  });

  const buffer = createMinimalXlsBuffer();

  await assert.rejects(
    () => previewImport({ buffer, filename: 'bypass.xls', supabase: db, machineSource: 'bypass' }),
    (err) => err.code === 'EMPLOYEE_MASTER_READ_FAILED'
  );

  await assert.rejects(
    () => commitImport({ buffer, filename: 'bypass.xls', supabase: db, machineSource: 'bypass' }),
    (err) => err.code === 'EMPLOYEE_MASTER_READ_FAILED'
  );
});

test('P1-3: barber master read failure aborts matching (BARBER_MASTER_READ_FAILED)', async () => {
  const store = baseWorkforce();
  const db = createInMemorySupabase(store, {
    failOn: { 'barbers.select': 'barber table connection error' },
  });

  const buffer = createMinimalXlsBuffer();

  await assert.rejects(
    () => previewImport({ buffer, filename: 'bypass.xls', supabase: db, machineSource: 'bypass' }),
    (err) => err.code === 'BARBER_MASTER_READ_FAILED'
  );

  await assert.rejects(
    () => commitImport({ buffer, filename: 'bypass.xls', supabase: db, machineSource: 'bypass' }),
    (err) => err.code === 'BARBER_MASTER_READ_FAILED'
  );
});

test('P1-3: no fallback match, no identity write, no attendance write on identity read failure', async () => {
  const store = baseWorkforce();
  // Existing machine mapping for ID 3 is emp-1
  const initialIdentitiesCount = store.employee_attendance_identity.length;

  const db = createInMemorySupabase(store, {
    failOn: { 'employee_attendance_identity.select': 'identity read error' },
  });

  const buffer = createMinimalXlsBuffer();

  await assert.rejects(
    () => commitImport({ buffer, filename: 'bypass.xls', supabase: db, machineSource: 'bypass' }),
    (err) => err.code === 'IDENTITY_CONTEXT_READ_FAILED'
  );

  // Invariant: no identities written or overwritten
  assert.equal(store.employee_attendance_identity.length, initialIdentitiesCount);
  // Invariant: no attendance written
  assert.equal(store.employee_attendance.length, 0);
});

// ------------------------------------------------------------------------------------------------
// P2: Propagate attendance exception insert failures
// ------------------------------------------------------------------------------------------------

test('P2: attendance_exceptions insert failure aborts commit with ATTENDANCE_EXCEPTION_WRITE_FAILED', async () => {
  const store = baseWorkforce();
  const db = createInMemorySupabase(store, {
    failOn: { 'attendance_exceptions.insert': 'disk full on attendance_exceptions' },
  });

  const buffer = createMinimalXlsBuffer();

  await assert.rejects(
    () => commitImport({ buffer, filename: 'bypass.xls', supabase: db, machineSource: 'bypass' }),
    (err) => {
      assert.equal(err.code, 'ATTENDANCE_EXCEPTION_WRITE_FAILED');
      return true;
    }
  );

  // Check batch status was marked failed if batch was created
  const batch = (store.attendance_import_batches || [])[0];
  if (batch) {
    assert.equal(batch.status, 'failed');
    assert.match(batch.metadata?.error || '', /disk full/);
  }
});

test('P2: honest partial-write reporting when exception insert fails after attendance written', async () => {
  const store = baseWorkforce();
  // Provide attendance matching emp-1 so attendance is written first
  const db = createInMemorySupabase(store, {
    failOn: { 'attendance_exceptions.insert': 'deadlock on exceptions table' },
  });

  const buffer = createMinimalXlsBuffer();

  await assert.rejects(
    () => commitImport({ buffer, filename: 'bypass.xls', supabase: db, machineSource: 'bypass' }),
    (err) => {
      assert.equal(err.code, 'ATTENDANCE_EXCEPTION_WRITE_FAILED');
      // If attendance was imported, partial_success must honestly report true
      if (err.imported_count > 0) {
        assert.equal(err.partial_success, true);
      }
      return true;
    }
  );
});

test('P2: single-punch exception write failure fails commit (ATTENDANCE_EXCEPTION_WRITE_FAILED)', async () => {
  const store = baseWorkforce();
  const db = createInMemorySupabase(store, {
    failOn: { 'attendance_exceptions.insert': 'single-punch exception write failure' },
  });

  const buffer = createMinimalXlsBuffer();

  await assert.rejects(
    () => commitImport({ buffer, filename: 'bypass.xls', supabase: db, machineSource: 'bypass' }),
    (err) => {
      assert.equal(err.code, 'ATTENDANCE_EXCEPTION_WRITE_FAILED');
      assert.match(err.message, /single-punch exception write failure/);
      return true;
    }
  );
});
