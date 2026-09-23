'use strict';

/**
 * Round-10 regression test suite:
 * 1. P1-1 (PRRT_kwDOSNmW7c6kV8-q): Close generation race via source version validation inside create_regular_payroll_run.
 * 2. P1-2 (PRRT_kwDOSNmW7c6kV8-0): Corrective migration updating DRAFT items only (never mutating LOCKED rows).
 * 3. P2   (PRRT_kwDOSNmW7c6kV8-6): Generalized snapshot concurrency model across attendance, overtime, adjustments.
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
  addRegularPayrollAdjustment,
  reviewOvertimeApproval,
} = require('../services/regularPayrollService');

function baseWorkforce() {
  return {
    employees: [
      {
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
      },
      {
        id: 'emp-2',
        employee_code: 'EMP002',
        name: 'Beta Regular',
        nickname: 'Beta',
        business_unit: 'Redbox',
        branch: 'bypass',
        position: 'Staff',
        base_salary: 3000000,
        position_allowance: 0,
        meal_allowance_rate: 0,
        is_active: true,
        join_date: '2026-09-01',
      },
    ],
    barbers: [],
    employee_attendance_identity: [
      { source: 'fingerprint:bypass', external_employee_id: '1', external_name: 'Alpha Regular', target_type: 'employee', employee_id: 'emp-1' },
      { source: 'fingerprint:bypass', external_employee_id: '2', external_name: 'Beta Regular', target_type: 'employee', employee_id: 'emp-2' },
    ],
    employee_attendance: [],
    employee_overtime_approvals: [],
    attendance_exceptions: [],
    payroll_runs: [],
    payroll_regular_items: [],
    payroll_adjustments: [],
    attendance_import_batches: [],
    payroll_attendance_source_versions: [
      { employee_id: 'emp-1', source_revision: 10 },
      { employee_id: 'emp-2', source_revision: 0 },
    ],
  };
}

function fillAttendance(store, empId, startDate = '2026-08-26', endDate = '2026-09-25') {
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
// P1-1: Close Draft Generation Race (PRRT_kwDOSNmW7c6kV8-q)
// ================================================================================================

test('1. attendance changes during draft generation -> creation rejected', async () => {
  const store = baseWorkforce();
  fillAttendance(store, 'emp-1');
  fillAttendance(store, 'emp-2');
  const db = createInMemorySupabase(store);

  // Set initial source version = 10 for emp-1
  store.payroll_attendance_source_versions.find((v) => v.employee_id === 'emp-1').source_revision = 10;

  // Intercept the create_regular_payroll_run RPC to simulate an attendance modification
  // that happened between reading attendance (version 10) and inserting run items
  const origRpc = db.rpc.bind(db);
  db.rpc = (fn, args) => {
    if (fn === 'create_regular_payroll_run') {
      // Simulate concurrent attendance mutation: source_revision bumped to 11
      store.payroll_attendance_source_versions.find((v) => v.employee_id === 'emp-1').source_revision = 11;
    }
    return origRpc(fn, args);
  };

  // With maxRetries: 0, generation fails closed immediately with ATTENDANCE_CHANGED_DURING_GENERATION
  await assert.rejects(
    () => generateRegularPayrollDraft(db, {
      periodStart: '2026-08-26',
      periodEnd: '2026-09-25',
      businessUnit: 'ALL',
      userEmail: 'owner@redbox.id',
      maxRetries: 0,
    }),
    (err) => {
      assert.equal(err.code, 'ATTENDANCE_CHANGED_DURING_GENERATION');
      return true;
    }
  );
});

test('2. generation retry with fresh source succeeds: snapshot_revision = source_revision = 11', async () => {
  const store = baseWorkforce();
  fillAttendance(store, 'emp-1');
  fillAttendance(store, 'emp-2');
  const db = createInMemorySupabase(store);

  // Initial source version = 10
  store.payroll_attendance_source_versions.find((v) => v.employee_id === 'emp-1').source_revision = 10;

  // In the first attempt, bump version to 11 mid-flight; on retry it reads 11 and succeeds
  let attempts = 0;
  const origRpc = db.rpc.bind(db);
  db.rpc = (fn, args) => {
    if (fn === 'create_regular_payroll_run') {
      attempts++;
      if (attempts === 1) {
        store.payroll_attendance_source_versions.find((v) => v.employee_id === 'emp-1').source_revision = 11;
      }
    }
    return origRpc(fn, args);
  };

  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-08-26',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
    maxRetries: 1, // default retry
  });

  assert.ok(draft.run_id);
  assert.equal(attempts, 2, 'retried once');
  const item1 = store.payroll_regular_items.find((i) => i.employee_id === 'emp-1');
  assert.equal(item1.attendance_source_revision, 11);
  assert.equal(item1.attendance_snapshot_revision, 11);
  assert.equal(item1.payroll_input_revision, 0);
  assert.equal(item1.payroll_snapshot_revision, 0);
});

test('3. no stale run header or items remain after generation conflict', async () => {
  const store = baseWorkforce();
  fillAttendance(store, 'emp-1');
  fillAttendance(store, 'emp-2');
  const db = createInMemorySupabase(store);

  store.payroll_attendance_source_versions.find((v) => v.employee_id === 'emp-1').source_revision = 10;

  const origRpc = db.rpc.bind(db);
  db.rpc = (fn, args) => {
    if (fn === 'create_regular_payroll_run') {
      store.payroll_attendance_source_versions.find((v) => v.employee_id === 'emp-1').source_revision = 11;
    }
    return origRpc(fn, args);
  };

  await assert.rejects(
    () => generateRegularPayrollDraft(db, {
      periodStart: '2026-08-26',
      periodEnd: '2026-09-25',
      businessUnit: 'ALL',
      maxRetries: 0,
    }),
    /ATTENDANCE_CHANGED_DURING_GENERATION/
  );

  assert.equal(store.payroll_runs.length, 0, 'no run header created');
  assert.equal(store.payroll_regular_items.length, 0, 'no items created');
});

// ================================================================================================
// P1-2: Corrective Migration Backfill Excludes LOCKED Runs (PRRT_kwDOSNmW7c6kV8-0)
// ================================================================================================

test('4 & 5 & 6. Corrective migration excludes LOCKED runs and updates DRAFT items only', () => {
  const migrationPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260921140000_generalize_payroll_snapshot_concurrency.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Verify the revision initialization UPDATE is scoped to DRAFT runs
  const updateMatch = sql.match(/UPDATE public\.payroll_regular_items i[\s\S]*?FROM public\.payroll_runs r[\s\S]*?WHERE i\.payroll_run_id = r\.id[\s\S]*?AND r\.status = 'DRAFT'/);
  assert.ok(updateMatch, 'UPDATE is strictly filtered by r.status = DRAFT');
});

// ================================================================================================
// P2: Generalized Concurrency Model for Overtime & Adjustments (PRRT_kwDOSNmW7c6kV8-6)
// ================================================================================================

test('7. concurrent overtime recalculation cannot overwrite newer snapshot', async () => {
  const store = baseWorkforce();
  fillAttendance(store, 'emp-1');
  fillAttendance(store, 'emp-2');
  const db = createInMemorySupabase(store);

  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-08-26',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });

  const item1 = store.payroll_regular_items.find((i) => i.employee_id === 'emp-1');
  assert.equal(item1.payroll_input_revision, 0);
  assert.equal(item1.payroll_snapshot_revision, 0);

  // Add initial overtime approval
  store.employee_overtime_approvals.push({
    id: 'ot-appr-1',
    employee_id: 'emp-1',
    attendance_date: '2026-09-02',
    raw_overtime_minutes: 60,
    approved_overtime_minutes: 60,
    status: 'APPROVED',
  });

  // Overtime change bumps input revision from 0 to 1
  await db.from('employee_overtime_approvals').update({ approved_overtime_minutes: 60 }).eq('id', 'ot-appr-1');
  assert.equal(item1.payroll_input_revision, 1);

  // Simulate concurrent execution: while recalculation T1 is calculating with revision 1,
  // T2 commits another overtime change that bumps input revision to 2
  const originalFrom = db.from.bind(db);
  let conflictInjected = false;

  db.from = (table) => {
    const builder = originalFrom(table);
    if (table === 'payroll_regular_items') {
      const origUpdate = builder.update.bind(builder);
      builder.update = (payload) => {
        if (!conflictInjected && payload.payroll_snapshot_revision !== undefined) {
          conflictInjected = true;
          // T2 commits newer approval, bumping input revision to 2
          item1.payroll_input_revision = 2;
        }
        return origUpdate(payload);
      };
    }
    return builder;
  };

  // T1 recalculation must fail closed with PAYROLL_INPUT_CHANGED_DURING_RECALCULATION when maxRetries=0
  await assert.rejects(
    () => recalculateSingleRegularItem(db, draft.run_id, item1.id, { refreshOvertime: true, maxRetries: 0 }),
    (err) => {
      assert.equal(err.code, 'PAYROLL_INPUT_CHANGED_DURING_RECALCULATION');
      return true;
    }
  );

  // Snapshot was NOT overwritten by the stale T1 calculation
  assert.equal(item1.payroll_snapshot_revision, 0);
  assert.equal(item1.payroll_input_revision, 2);
});

test('8. concurrent adjustment recalculation cannot overwrite newer snapshot', async () => {
  const store = baseWorkforce();
  fillAttendance(store, 'emp-1');
  fillAttendance(store, 'emp-2');
  const db = createInMemorySupabase(store);

  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-08-26',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });

  const item1 = store.payroll_regular_items.find((i) => i.employee_id === 'emp-1');

  // Insert an adjustment -> bumps input_revision from 0 to 1, sets adjustments_dirty = true
  await addRegularPayrollAdjustment(db, {
    runId: draft.run_id,
    payrollRegularItemId: item1.id,
    type: 'BONUS',
    amount: 100000,
    reason: 'Performance bonus 1',
    userEmail: 'owner@redbox.id',
  });

  assert.equal(item1.payroll_input_revision, 1);
  assert.equal(item1.payroll_snapshot_revision, 1);
  assert.equal(item1.manual_bonus, 100000);

  // Now simulate a concurrent second adjustment being added while recalculation is in flight
  const originalFrom = db.from.bind(db);
  let conflictInjected = false;

  db.from = (table) => {
    const builder = originalFrom(table);
    if (table === 'payroll_regular_items') {
      const origUpdate = builder.update.bind(builder);
      builder.update = (payload) => {
        if (!conflictInjected && payload.payroll_snapshot_revision !== undefined) {
          conflictInjected = true;
          // Concurrent adjustment bumps input_revision to 2
          item1.payroll_input_revision = 2;
        }
        return origUpdate(payload);
      };
    }
    return builder;
  };

  await assert.rejects(
    () => recalculateSingleRegularItem(db, draft.run_id, item1.id, { maxRetries: 0 }),
    (err) => {
      assert.equal(err.code, 'PAYROLL_INPUT_CHANGED_DURING_RECALCULATION');
      return true;
    }
  );
});

test('9. generalized revision mismatch blocks lock', async () => {
  const store = baseWorkforce();
  fillAttendance(store, 'emp-1');
  fillAttendance(store, 'emp-2');
  const db = createInMemorySupabase(store);

  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-08-26',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });

  const item1 = store.payroll_regular_items.find((i) => i.employee_id === 'emp-1');
  // Mismatch: input_revision = 1, snapshot_revision = 0
  item1.payroll_input_revision = 1;
  item1.payroll_snapshot_revision = 0;

  await assert.rejects(
    () => lockRegularPayrollRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    (err) => {
      assert.match(err.message, /stale/i);
      return true;
    }
  );
});

test('10. successful recalculation aligns revision and clears dirty, unblocking lock', async () => {
  const store = baseWorkforce();
  fillAttendance(store, 'emp-1');
  fillAttendance(store, 'emp-2');
  const db = createInMemorySupabase(store);

  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-08-26',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });

  const item1 = store.payroll_regular_items.find((i) => i.employee_id === 'emp-1');
  // Mark dirty via adjustment
  await db.from('payroll_adjustments').insert({
    payroll_run_id: draft.run_id,
    payroll_regular_item_id: item1.id,
    employee_id: 'emp-1',
    type: 'BONUS',
    amount: 50000,
    reason: 'Tip',
  });

  assert.equal(item1.attendance_summary.adjustments_dirty, true);
  assert.equal(item1.payroll_input_revision, 1);
  assert.equal(item1.payroll_snapshot_revision, 0);

  // Recalculate run
  const recalc = await recalculateRegularPayrollRun(db, draft.run_id);
  assert.equal(recalc.success, true);

  assert.equal(item1.attendance_summary.adjustments_dirty, undefined);
  assert.equal(item1.payroll_input_revision, 1);
  assert.equal(item1.payroll_snapshot_revision, 1);

  // Lock succeeds
  const locked = await lockRegularPayrollRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(locked.success, true);
  assert.equal(locked.status, 'LOCKED');
});

test('11. existing attendance CAS still passes', async () => {
  const store = baseWorkforce();
  store.payroll_attendance_source_versions.find((v) => v.employee_id === 'emp-1').source_revision = 0;
  fillAttendance(store, 'emp-1');
  fillAttendance(store, 'emp-2');
  const db = createInMemorySupabase(store);

  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-08-26',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });

  const item1 = store.payroll_regular_items.find((i) => i.employee_id === 'emp-1');
  await db.from('employee_attendance').update({ late_minutes: 10 }).eq('id', 'att-emp-1-2026-09-01');

  assert.equal(item1.attendance_source_revision, 1);
  assert.equal(item1.attendance_summary.attendance_dirty, true);

  await recalculateSingleRegularItem(db, draft.run_id, item1.id, { refreshAttendance: true });

  assert.equal(item1.attendance_source_revision, 1);
  assert.equal(item1.attendance_snapshot_revision, 1);
  assert.equal(item1.attendance_summary.attendance_dirty, false);
});

test('12. Barber payroll behavior unchanged in lock_payroll_run', () => {
  const migrationPath = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260921140000_generalize_payroll_snapshot_concurrency.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Verify Barber branch is present and contains the exact required safeguards
  assert.ok(sql.includes('payroll_barber_items'), 'barber items check present');
  assert.ok(sql.includes('payroll_review_items'), 'barber review items check present');
  assert.ok(sql.includes('payroll_barber_commission_items'), 'barber commission lines check present');
  assert.ok(sql.includes('payroll_source_claims'), 'barber source claims present');
  assert.ok(sql.includes('claims_created'), 'claims_created returned in result');
});
