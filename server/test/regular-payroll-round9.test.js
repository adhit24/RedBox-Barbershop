'use strict';

/**
 * Round-9 regression test suite:
 * 1. P1-1 (PRRT_kwDOSNmW7c6kU8Ie): Compare-and-swap (CAS) optimistic concurrency on attendance revisions.
 *    Stale recalculation cannot clear dirty marker. Lock invariant rejects source != snapshot revision.
 * 2. P1-2 (PRRT_kwDOSNmW7c6kU8Ik): Exclude active employees joining after period_end from draft & coverage.
 * 3. P1-3 (PRRT_kwDOSNmW7c6kU8Iq): Owner-only recalculation action on DRAFT runs, rejected on LOCKED runs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const { createInMemorySupabase } = require('./helpers/inMemorySupabase');
const {
  generateRegularPayrollDraft,
  recalculateSingleRegularItem,
  recalculateRegularPayrollRun,
  lockRegularPayrollRun,
  computeRunAttendanceCoverage,
  isEmployeeEligibleForPeriod,
  fetchEligibleRegularEmployees,
} = require('../services/regularPayrollService');
const { createRegularPayrollRoutes } = require('../routes/regularPayroll');

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
// P1-1: Revision CAS & Concurrency Guards
// ================================================================================================

test('P1-1: attendance mutation increments attendance_source_revision and sets attendance_dirty = true', async () => {
  const store = baseWorkforce();
  fillAttendance(store, 'emp-1');
  const db = createInMemorySupabase(store);

  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-08-26',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });

  const itemBefore = store.payroll_regular_items.find((i) => i.employee_id === 'emp-1');
  assert.equal(itemBefore.attendance_source_revision, 0);
  assert.equal(itemBefore.attendance_snapshot_revision, 0);
  assert.equal(itemBefore.attendance_summary?.attendance_dirty, undefined);

  // Trigger attendance mutation for emp-1
  await db.from('employee_attendance').update({ late_minutes: 15 }).eq('id', `att-emp-1-2026-09-01`);

  const itemAfter = store.payroll_regular_items.find((i) => i.employee_id === 'emp-1');
  assert.equal(itemAfter.attendance_source_revision, 1, 'attendance_source_revision incremented');
  assert.equal(itemAfter.attendance_snapshot_revision, 0, 'attendance_snapshot_revision unchanged');
  assert.equal(itemAfter.attendance_summary?.attendance_dirty, true, 'attendance_dirty set to true');
});

test('P1-1: attendance change between read & write fails CAS, raises ATTENDANCE_CHANGED_DURING_RECALCULATION, preserves dirty', async () => {
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

  const targetItem = store.payroll_regular_items.find((i) => i.employee_id === 'emp-1');

  // Simulate an attendance correction that happens concurrently:
  // Step 1: An attendance edit occurs, moving source_revision to 1 + dirty = true
  await db.from('employee_attendance').update({ late_minutes: 20 }).eq('id', `att-emp-1-2026-09-02`);
  assert.equal(targetItem.attendance_source_revision, 1);
  assert.equal(targetItem.attendance_summary.attendance_dirty, true);

  // Step 2: Now simulate a race where another correction fires while recalculation is computing:
  // We hook the db to simulate that while recalculating emp-1, right before the CAS update,
  // attendance is updated again, moving source_revision to 2!
  const originalFrom = db.from.bind(db);
  let injectedConflict = false;

  db.from = (table) => {
    const builder = originalFrom(table);
    if (table === 'payroll_regular_items') {
      const origUpdate = builder.update.bind(builder);
      builder.update = (payload) => {
        if (!injectedConflict && payload.attendance_snapshot_revision !== undefined) {
          injectedConflict = true;
          // Concurrent correction bumps source revision to 2
          targetItem.attendance_source_revision = 2;
          targetItem.attendance_summary.attendance_dirty = true;
        }
        return origUpdate(payload);
      };
    }
    return builder;
  };

  // Step 3: Recalculate with refreshAttendance. The CAS update should see 0 rows updated
  // because source_revision was read as 1, but by update time it was 2.
  await assert.rejects(
    () => recalculateSingleRegularItem(db, draft.run_id, targetItem.id, { refreshAttendance: true }),
    (err) => {
      assert.equal(err.code, 'ATTENDANCE_CHANGED_DURING_RECALCULATION');
      return true;
    }
  );

  // Verify dirty marker remained true and snapshot revision did NOT update to stale value
  assert.equal(targetItem.attendance_summary.attendance_dirty, true, 'dirty marker remains true');
  assert.equal(targetItem.attendance_snapshot_revision, 0, 'snapshot revision not advanced to stale read');
  assert.equal(targetItem.attendance_source_revision, 2);

  // Step 4: Lock MUST be rejected because revisions do not match and item is dirty
  await assert.rejects(
    () => lockRegularPayrollRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    (err) => {
      assert.match(err.message, /stale/i);
      return true;
    }
  );
});

test('P1-1: successful recalculation aligns revisions and clears dirty, unblocking lock', async () => {
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

  const targetItem = store.payroll_regular_items.find((i) => i.employee_id === 'emp-1');

  // Mutation: attendance changes
  await db.from('employee_attendance').update({ late_minutes: 10 }).eq('id', `att-emp-1-2026-09-02`);
  assert.equal(targetItem.attendance_source_revision, 1);
  assert.equal(targetItem.attendance_summary.attendance_dirty, true);

  // Recalculate cleanly
  const recalcRes = await recalculateRegularPayrollRun(db, draft.run_id);
  assert.equal(recalcRes.success, true);
  assert.equal(recalcRes.recalculated_count, 1);

  // Item revisions aligned and dirty cleared
  assert.equal(targetItem.attendance_source_revision, 1);
  assert.equal(targetItem.attendance_snapshot_revision, 1);
  assert.equal(targetItem.attendance_summary.attendance_dirty, false);

  // Lock succeeds
  const lockRes = await lockRegularPayrollRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(lockRes.status, 'LOCKED');
});

test('P1-1: recalculateRegularPayrollRun retries once on ATTENDANCE_CHANGED_DURING_RECALCULATION', async () => {
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

  const targetItem = store.payroll_regular_items.find((i) => i.employee_id === 'emp-1');
  await db.from('employee_attendance').update({ late_minutes: 5 }).eq('id', `att-emp-1-2026-09-02`);

  // Inject a single race on first attempt
  let raceCount = 0;
  const originalFrom = db.from.bind(db);
  db.from = (table) => {
    const builder = originalFrom(table);
    if (table === 'payroll_regular_items') {
      const origUpdate = builder.update.bind(builder);
      builder.update = (payload) => {
        if (raceCount === 0 && payload.attendance_snapshot_revision !== undefined) {
          raceCount++;
          // Bump source revision behind the back once
          targetItem.attendance_source_revision++;
        }
        return origUpdate(payload);
      };
    }
    return builder;
  };

  // Recalculate: should catch the first error and retry once, succeeding on the second pass
  const res = await recalculateRegularPayrollRun(db, draft.run_id);
  assert.equal(res.success, true);
  assert.equal(targetItem.attendance_source_revision, targetItem.attendance_snapshot_revision);
  assert.equal(targetItem.attendance_summary.attendance_dirty, false);
});

// ================================================================================================
// P1-2: Population & Eligibility Rules (join_date vs period_end)
// ================================================================================================

test('P1-2: isEmployeeEligibleForPeriod strictly evaluates join_date vs period_end', () => {
  const periodEnd = '2026-09-25';

  // A: join_date null -> included
  assert.equal(isEmployeeEligibleForPeriod({ join_date: null }, periodEnd), true);
  assert.equal(isEmployeeEligibleForPeriod({ join_date: undefined }, periodEnd), true);
  assert.equal(isEmployeeEligibleForPeriod({ join_date: '' }, periodEnd), true);

  // B: join_date before period_end -> included
  assert.equal(isEmployeeEligibleForPeriod({ join_date: '2026-08-01' }, periodEnd), true);
  assert.equal(isEmployeeEligibleForPeriod({ join_date: '2026-09-01' }, periodEnd), true);

  // C: join_date equal period_end -> included
  assert.equal(isEmployeeEligibleForPeriod({ join_date: '2026-09-25' }, periodEnd), true);

  // D: join_date after period_end -> EXCLUDED
  assert.equal(isEmployeeEligibleForPeriod({ join_date: '2026-09-26' }, periodEnd), false);
  assert.equal(isEmployeeEligibleForPeriod({ join_date: '2026-10-01' }, periodEnd), false);
});

test('P1-2: historical draft generation excludes employees who join after period_end', async () => {
  const store = baseWorkforce();
  // Set up four test employees:
  // A: join_date = null
  // B: join_date = 2026-09-01
  // C: join_date = 2026-09-25
  // D: join_date = 2026-09-26 (after period end)
  store.employees = [
    {
      id: 'emp-a',
      employee_code: 'EMP-A',
      name: 'Employee A',
      business_unit: 'Redbox',
      branch: 'bypass',
      position: 'Staff',
      base_salary: 2000000,
      is_active: true,
      join_date: null,
    },
    {
      id: 'emp-b',
      employee_code: 'EMP-B',
      name: 'Employee B',
      business_unit: 'Redbox',
      branch: 'bypass',
      position: 'Staff',
      base_salary: 2000000,
      is_active: true,
      join_date: '2026-09-01',
    },
    {
      id: 'emp-c',
      employee_code: 'EMP-C',
      name: 'Employee C',
      business_unit: 'Redbox',
      branch: 'bypass',
      position: 'Staff',
      base_salary: 2000000,
      is_active: true,
      join_date: '2026-09-25',
    },
    {
      id: 'emp-d',
      employee_code: 'EMP-D',
      name: 'Employee D',
      business_unit: 'Redbox',
      branch: 'bypass',
      position: 'Staff',
      base_salary: 2000000,
      is_active: true,
      join_date: '2026-09-26', // Join after period end
    },
  ];

  fillAttendance(store, 'emp-a');
  fillAttendance(store, 'emp-b');
  fillAttendance(store, 'emp-c');
  // Employee D has no attendance

  const db = createInMemorySupabase(store);

  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-08-26',
    periodEnd: '2026-09-25',
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });

  // Check generated items
  const empIds = store.payroll_regular_items.map((i) => i.employee_id);
  assert.ok(empIds.includes('emp-a'), 'emp-a with null join_date included');
  assert.ok(empIds.includes('emp-b'), 'emp-b with 2026-09-01 included');
  assert.ok(empIds.includes('emp-c'), 'emp-c with 2026-09-25 included');
  assert.ok(!empIds.includes('emp-d'), 'emp-d with 2026-09-26 EXCLUDED');

  // Verify emp-d does not create MISSING_ATTENDANCE or block the run
  const statuses = store.payroll_regular_items.map((i) => i.status);
  assert.ok(!statuses.includes('MISSING_ATTENDANCE'));
  assert.ok(!statuses.includes('REVIEW_REQUIRED'));

  // Run can be locked without being blocked by future joiner
  const lockRes = await lockRegularPayrollRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(lockRes.status, 'LOCKED');
});

test('P1-2: computeRunAttendanceCoverage excludes future joiners from expected coverage', async () => {
  const store = baseWorkforce();
  store.employees.push({
    id: 'emp-future',
    employee_code: 'EMP-F',
    name: 'Future Joiner',
    business_unit: 'Redbox',
    branch: 'bypass',
    position: 'Staff',
    base_salary: 2000000,
    is_active: true,
    join_date: '2026-09-28', // After period_end 2026-09-25
  });

  fillAttendance(store, 'emp-1');
  fillAttendance(store, 'emp-2');
  const db = createInMemorySupabase(store);

  const coverage = await computeRunAttendanceCoverage(db, {
    businessUnit: 'ALL',
    periodStart: '2026-08-26',
    periodEnd: '2026-09-25',
  });

  assert.equal(coverage.attendance_period_complete, true, 'coverage is complete because future joiner is not counted');
  assert.equal(coverage.attendance_data_through, '2026-09-25');
});

// ================================================================================================
// P1-3: Recalculate Action Authorization & Status Checks
// ================================================================================================

test('P1-3: recalculateRegularPayrollRun rejects on LOCKED run', async () => {
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

  await lockRegularPayrollRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' });

  await assert.rejects(
    () => recalculateRegularPayrollRun(db, draft.run_id),
    (err) => {
      assert.equal(err.code, 'RUN_NOT_DRAFT');
      return true;
    }
  );
});

test('P1-3: POST /:id/recalculate route is owner-only', async () => {
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

  const app = express();
  app.use(express.json());

  const mockAdminAuth = (req, res, next) => {
    const role = req.headers['x-test-role'] || 'manager';
    req.adminAuth = {
      userId: 'test-user-id',
      email: role === 'owner' ? 'owner@redbox.id' : 'manager@redbox.id',
      role,
    };
    next();
  };

  app.use('/api/payroll/regular-runs', createRegularPayrollRoutes(db, null, { adminAuth: mockAdminAuth }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Manager attempts recalculate -> 403 Forbidden
    const resManager = await fetch(`${baseUrl}/api/payroll/regular-runs/${draft.run_id}/recalculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-role': 'manager' },
      body: JSON.stringify({ all: true }),
    });
    assert.equal(resManager.status, 403);
    const bodyManager = await resManager.json();
    assert.match(bodyManager.error, /Only Owner can manage regular payroll/i);

    // 2. Branch admin attempts recalculate -> 403 Forbidden
    const resAdmin = await fetch(`${baseUrl}/api/payroll/regular-runs/${draft.run_id}/recalculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-role': 'branch_admin' },
      body: JSON.stringify({ all: true }),
    });
    assert.equal(resAdmin.status, 403);

    // 3. Owner invokes recalculate -> 200 OK
    const resOwner = await fetch(`${baseUrl}/api/payroll/regular-runs/${draft.run_id}/recalculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-role': 'owner' },
      body: JSON.stringify({ all: true }),
    });
    assert.equal(resOwner.status, 200);
    const bodyOwner = await resOwner.json();
    assert.equal(bodyOwner.success, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
