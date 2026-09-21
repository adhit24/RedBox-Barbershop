'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateRegularPayrollDraft,
  getRegularPayrollRunDetail,
  addRegularPayrollAdjustment,
  deleteRegularPayrollAdjustment,
  lockRegularPayrollRun,
} = require('../services/regularPayrollService');

/**
 * Isolated in-memory Mock Supabase DB that simulates tables & immutability triggers:
 * - payroll_runs
 * - payroll_regular_items (with trg_pri_regular_immutability)
 * - payroll_adjustments (with trg_pa_immutability)
 * - employees
 * - employee_attendance
 * - attendance_exceptions
 */
const { emulateCreateRegularPayrollRun } = require('./helpers/regularPayrollRpc');

function createMockDb(initialState = {}) {
  const tables = {
    payroll_runs: initialState.payroll_runs || [],
    payroll_regular_items: initialState.payroll_regular_items || [],
    payroll_adjustments: initialState.payroll_adjustments || [],
    employees: initialState.employees || [],
    employee_attendance: initialState.employee_attendance || [],
    attendance_exceptions: initialState.attendance_exceptions || [],
    employee_overtime_approvals: initialState.employee_overtime_approvals || [],
  };

  let idCounter = 1;

  const mock = {
    tables,
    from(table) {
      const rows = tables[table] || [];

      return {
        select(cols, { count, head } = {}) {
          let filtered = [...rows];
          const queryObj = {
            eq(col, val) {
              filtered = filtered.filter((r) => r[col] === val);
              return queryObj;
            },
            neq(col, val) {
              filtered = filtered.filter((r) => r[col] !== val);
              return queryObj;
            },
            in(col, vals) {
              filtered = filtered.filter((r) => vals.includes(r[col]));
              return queryObj;
            },
            gt(col, val) {
              filtered = filtered.filter((r) => r[col] > val);
              return queryObj;
            },
            gte(col, val) {
              filtered = filtered.filter((r) => r[col] >= val);
              return queryObj;
            },
            lte(col, val) {
              filtered = filtered.filter((r) => r[col] <= val);
              return queryObj;
            },
            or(expr) {
              // Simple OR parser for status or business_unit
              return queryObj;
            },
            order(col, { ascending = true } = {}) {
              filtered.sort((a, b) => {
                const cmp = String(a[col] || '').localeCompare(String(b[col] || ''));
                return ascending ? cmp : -cmp;
              });
              return queryObj;
            },
            limit(n) {
              filtered = filtered.slice(0, n);
              return queryObj;
            },
            single: async () => ({
              data: filtered[0] || null,
              error: filtered[0] ? null : { message: 'Row not found' },
            }),
            maybeSingle: async () => ({
              data: filtered[0] || null,
              error: null,
            }),
            then(resolve) {
              resolve({
                data: head ? null : filtered,
                count: count ? filtered.length : null,
                error: null,
              });
            },
          };
          return queryObj;
        },
        insert(data) {
          const toInsert = Array.isArray(data) ? data : [data];

          // Check immutability on adjustments insert
          if (table === 'payroll_adjustments') {
            for (const item of toInsert) {
              const run = tables.payroll_runs.find((r) => r.id === item.payroll_run_id);
              if (run && run.status === 'LOCKED') {
                const err = new Error('Cannot insert adjustment: payroll run is LOCKED');
                return {
                  select: () => ({
                    single: async () => ({ data: null, error: err }),
                  }),
                  then(resolve) {
                    resolve({ data: null, error: err });
                  },
                };
              }
            }
          }

          const inserted = toInsert.map((item) => {
            const row = {
              ...item,
              id: item.id || `mock-${table}-${idCounter++}`,
              created_at: item.created_at || new Date().toISOString(),
              updated_at: item.updated_at || new Date().toISOString(),
            };
            rows.push(row);
            return row;
          });

          return {
            select: () => ({
              single: async () => ({ data: inserted[0] || null, error: null }),
            }),
            then(resolve) {
              resolve({ data: Array.isArray(data) ? inserted : inserted[0], error: null });
            },
          };
        },
        update(updates) {
          const filters = [];
          const execute = (mustExist) => {
            const target = rows.find((r) => filters.every((f) => f(r)));
            if (table === 'payroll_regular_items' && target) {
              const run = tables.payroll_runs.find((r) => r.id === target.payroll_run_id);
              if (run && run.status === 'LOCKED') {
                const err = new Error('Cannot modify payroll_regular_items: payroll run is LOCKED and immutable');
                return { data: null, error: err };
              }
            }
            if (table === 'payroll_runs' && target) {
              if (target.status === 'LOCKED') {
                const err = new Error('Cannot modify payroll run: run is LOCKED and immutable');
                return { data: null, error: err };
              }
            }
            if (target) {
              Object.assign(target, updates, { updated_at: new Date().toISOString() });
            }
            return { data: target || null, error: (mustExist && !target) ? { message: 'not found' } : null };
          };
          const builder = {
            eq(col, val) {
              filters.push((r) => r[col] === val);
              return builder;
            },
            select() {
              return builder;
            },
            single: async () => execute(true),
            maybeSingle: async () => execute(false),
            then(resolve) {
              resolve(execute(false));
            },
          };
          return builder;
        },
        delete() {
          return {
            eq(col, val) {
              const idx = rows.findIndex((r) => r[col] === val);
              if (idx !== -1) {
                const target = rows[idx];
                if (table === 'payroll_runs' && target.status === 'LOCKED') {
                  const err = new Error('Cannot delete payroll run: run is LOCKED');
                  return Promise.resolve({ data: null, error: err });
                }
                rows.splice(idx, 1);
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
    rpc(fnName, args) {
      if (fnName === 'create_regular_payroll_run') {
        return Promise.resolve(emulateCreateRegularPayrollRun(tables, args, { idFactory: () => `mock-id-${idCounter++}` }));
      }
      if (fnName === 'lock_payroll_run') {
        const run = tables.payroll_runs.find((r) => r.id === args.p_run_id);
        if (!run) {
          return Promise.resolve({ data: null, error: { message: 'Run not found' } });
        }
        if (run.status === 'LOCKED') {
          return Promise.resolve({ data: null, error: { message: 'Run already locked' } });
        }
        run.status = 'LOCKED';
        run.locked_at = new Date().toISOString();
        run.locked_by = args.p_user_email || 'admin@redbox.id';
        return Promise.resolve({ data: { success: true, status: 'LOCKED', run_id: run.id }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `Unknown RPC ${fnName}` } });
    },
  };

  return mock;
}

test('End-to-End Regular Payroll Lifecycle (Draft -> Adjustment -> Lock -> Immutability)', async () => {
  // Setup isolated mock DB with 35 employees
  const mockEmployees = [
    {
      id: 'emp-1',
      name: 'Adam Apriliano Fahrezy',
      nickname: 'Adam',
      business_unit: 'Redbox',
      branch: 'bypass',
      position: 'Staff',
      base_salary: 1000000,
      position_allowance: 0,
      meal_allowance_rate: 0,
      is_active: true,
    },
    {
      id: 'emp-2',
      name: 'Aditiya Nugraha',
      nickname: 'Adit',
      business_unit: 'Redbox',
      branch: 'sumber',
      position: 'Staff',
      base_salary: 1000000,
      position_allowance: 0,
      meal_allowance_rate: 0,
      is_active: true,
    },
    {
      id: 'emp-3',
      name: 'Abi Bhakti',
      nickname: 'Abi',
      business_unit: 'Sundaze',
      branch: 'bypass',
      position: 'Staff',
      base_salary: 1800000,
      position_allowance: 500000,
      meal_allowance_rate: 20000,
      is_active: true,
    },
  ];

  for (let i = 4; i <= 35; i++) {
    mockEmployees.push({
      id: `emp-${i}`,
      name: `Employee ${i}`,
      business_unit: i % 2 === 0 ? 'Redbox' : 'Sundaze',
      branch: 'branch',
      position: 'Staff',
      base_salary: 1500000,
      position_allowance: 100000,
      meal_allowance_rate: 15000,
      is_active: true,
    });
  }

  const mockDb = createMockDb({
    employees: mockEmployees,
    employee_attendance: [
      {
        employee_id: 'emp-1',
        attendance_date: '2026-08-27',
        status: 'hadir',
        late_minutes: 0,
        overtime_minutes: 0,
        first_check_in: '09:00',
        last_check_out: '17:00',
      },
      {
        employee_id: 'emp-1',
        attendance_date: '2026-08-28',
        status: 'terlambat',
        late_minutes: 15,
        overtime_minutes: 0,
        first_check_in: '09:15',
        last_check_out: '17:00',
      },
    ],
  });

  // 1. Generate Draft
  const periodStart = '2026-08-26';
  const periodEnd = '2026-09-25';

  const genRes = await generateRegularPayrollDraft(mockDb, {
    periodStart,
    periodEnd,
    businessUnit: 'ALL',
    userEmail: 'test-admin@redbox.id',
  });

  assert.equal(genRes.success, true);
  assert.equal(genRes.status, 'DRAFT');
  assert.ok(genRes.run_id);
  const createdRunId = genRes.run_id;

  // 2. Fetch Detail
  const detail = await getRegularPayrollRunDetail(mockDb, { runId: createdRunId });
  assert.equal(detail.run.id, createdRunId);
  assert.equal(detail.run.status, 'DRAFT');
  assert.ok(detail.items.length >= 30, 'Should have regular employees');

  const firstItem = detail.items[0];
  const initialTakeHome = Number(firstItem.take_home_pay);

  // 3. Add Manual Adjustment (DEBT of 100,000)
  const adjRes = await addRegularPayrollAdjustment(mockDb, {
    runId: createdRunId,
    payrollRegularItemId: firstItem.id,
    employeeId: firstItem.employee_id,
    type: 'DEBT',
    amount: 100000,
    reason: 'Kasbon test lifecycle',
    userEmail: 'test-admin@redbox.id',
  });

  assert.equal(adjRes.success, true);

  // Re-fetch detail to verify item recalculation
  const updatedDetail = await getRegularPayrollRunDetail(mockDb, { runId: createdRunId });
  const updatedItem = updatedDetail.items.find((it) => it.id === firstItem.id);
  assert.equal(Number(updatedItem.debt_deduction), 100000);
  assert.equal(Number(updatedItem.take_home_pay), initialTakeHome - 100000);

  // 4. Verify Safety Guard: Attempting to lock when blockers exist MUST FAIL
  await assert.rejects(
    async () => {
      await lockRegularPayrollRun(mockDb, {
        runId: createdRunId,
        userEmail: 'test-admin@redbox.id',
      });
    },
    /incomplete attendance|blocked/i,
    'Safety guard must block locking payroll run when incomplete attendance or blocked source exists'
  );

  // Mark mock items to READY in mockDb to simulate attendance/data blockers resolved
  for (const it of mockDb.tables.payroll_regular_items) {
    if (it.payroll_run_id === createdRunId) {
      it.status = 'READY';
    }
  }

  // 4a. Period guard: attendance only covers part of the period -> lock must still be blocked
  await assert.rejects(
    async () => lockRegularPayrollRun(mockDb, { runId: createdRunId, userEmail: 'test-admin@redbox.id' }),
    /attendance data is only available through/i,
    'Lock must be blocked while attendance data does not cover the whole payroll period'
  );

  // Simulate the final fingerprint file covering the whole period
  const runRow = mockDb.tables.payroll_runs.find(r => r.id === createdRunId);
  runRow.summary = { ...runRow.summary, attendance_period_complete: true };

  // 4b. Lock the run after blockers are resolved
  const lockRes = await lockRegularPayrollRun(mockDb, {
    runId: createdRunId,
    userEmail: 'test-admin@redbox.id',
  });
  assert.equal(lockRes.status, 'LOCKED');

  // 5. Verify Immutability: Mutating an item after lock MUST FAIL
  const { error: postLockUpdateErr } = await mockDb
    .from('payroll_regular_items')
    .update({ base_salary: 9999999 })
    .eq('id', firstItem.id);

  assert.ok(postLockUpdateErr, 'Database trigger must reject update on locked regular payroll item');
  assert.match(postLockUpdateErr.message, /LOCKED/);

  // 6. Verify Immutability: Adding adjustment after lock MUST FAIL
  const { error: postLockAdjErr } = await mockDb
    .from('payroll_adjustments')
    .insert({
      payroll_run_id: createdRunId,
      payroll_regular_item_id: firstItem.id,
      employee_id: firstItem.employee_id,
      type: 'BONUS',
      amount: 50000,
      reason: 'Late bonus',
      created_by: 'test@test.com',
    });
  assert.ok(postLockAdjErr, 'Database trigger must reject adjustment on locked run');
  assert.match(postLockAdjErr.message, /LOCKED/);

  // 7. Verify Snapshot Protection: Changing master salary does NOT affect locked snapshot
  const emp = mockDb.tables.employees.find((e) => e.id === firstItem.employee_id);
  emp.base_salary = 99999999;
  const lockedDetail = await getRegularPayrollRunDetail(mockDb, { runId: createdRunId });
  const itemAfterMasterChange = lockedDetail.items.find((it) => it.id === firstItem.id);
  assert.equal(Number(itemAfterMasterChange.base_salary), Number(firstItem.base_salary));

  // 8. Verify Snapshot Protection: Changing attendance does NOT affect locked snapshot
  mockDb.tables.employee_attendance.push({
    employee_id: firstItem.employee_id,
    attendance_date: '2026-08-30',
    status: 'hadir',
  });
  const lockedDetail2 = await getRegularPayrollRunDetail(mockDb, { runId: createdRunId });
  const itemAfterAttChange = lockedDetail2.items.find((it) => it.id === firstItem.id);
  assert.equal(Number(itemAfterAttChange.work_days), Number(firstItem.work_days));
});

// ---------------------------------------------------------------------------
// Overtime review must propagate into DRAFT payroll snapshots
// ---------------------------------------------------------------------------
const { reviewOvertimeApproval, syncOvertimeCandidates } = require('../services/regularPayrollService');

async function setupOvertimeDraft() {
  const attendance = [];
  for (let d = 26; d <= 31; d++) attendance.push(['2026-08-' + d]);
  for (let d = 1; d <= 14; d++) attendance.push(['2026-09-' + String(d).padStart(2, '0')]);
  const db = createMockDb({
    employees: [{
      id: 'emp-ot', name: 'Overtime Tester', nickname: 'OT', business_unit: 'Redbox', branch: 'bypass',
      position: 'Staff', base_salary: 3000000, position_allowance: 0, meal_allowance_rate: 0, is_active: true,
    }],
    employee_attendance: attendance.map(([date]) => ({
      // the source of the pending 120-minute candidate below
      employee_id: 'emp-ot', attendance_date: date, status: 'hadir', late_minutes: 0, overtime_minutes: date === '2026-09-02' ? 120 : 0,
      first_check_in: '08:00', last_check_out: '17:00',
    })),
    employee_overtime_approvals: [{
      id: 'ot-1', employee_id: 'emp-ot', attendance_date: '2026-09-02', raw_overtime_minutes: 120,
      approved_overtime_minutes: 0, status: 'PENDING', note: null,
    }],
  });
  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-08-26', periodEnd: '2026-09-25', businessUnit: 'ALL', userEmail: 'test@redbox.id',
  });
  const item = () => db.tables.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id);
  const run = () => db.tables.payroll_runs.find((r) => r.id === draft.run_id);
  return { db, draft, item, run };
}

test('Overtime review APPROVED recalculates the DRAFT item and run summary (no stale snapshot)', async () => {
  const { db, item, run } = await setupOvertimeDraft();
  const before = { ...item() };
  assert.equal(before.status, 'REVIEW_REQUIRED', 'pending overtime keeps the item in review');
  assert.equal(before.overtime_amount, 0);
  assert.equal(run().summary.review_required_count, 1);

  const res = await reviewOvertimeApproval(db, {
    approvalId: 'ot-1', status: 'APPROVED', approvedMinutes: 120, userEmail: 'manager@redbox.id',
  });

  assert.equal(res.approval.status, 'APPROVED');
  assert.equal(res.recalculation.error, null);
  assert.equal(res.recalculation.updated.length, 1);
  const after = item();
  assert.equal(after.overtime_hours, 2);
  assert.equal(after.overtime_amount, 15000);
  assert.equal(after.gross_pay, before.gross_pay + 15000);
  assert.equal(after.take_home_pay, before.take_home_pay + 15000);
  assert.equal(after.attendance_summary.pending_overtime_count, 0);
  assert.equal(after.attendance_summary.approved_overtime_minutes, 120);
  assert.equal(after.status, 'READY');
  assert.ok(!after.warnings.some((w) => /lembur menunggu/.test(w)));
  assert.equal(run().summary.review_required_count, 0);
  assert.equal(run().summary.total_gross_pay, after.gross_pay);
  assert.equal(run().summary.total_take_home_pay, after.take_home_pay);
  // Header fields that are not recomputed by refreshRunSummary must survive
  assert.equal(run().summary.attendance_period_complete, false);
});

test('Overtime review REJECTED clears pending, keeps overtime at 0 and refreshes summary', async () => {
  const { db, item, run } = await setupOvertimeDraft();
  const gross = item().gross_pay;

  const res = await reviewOvertimeApproval(db, { approvalId: 'ot-1', status: 'REJECTED', userEmail: 'manager@redbox.id' });

  assert.equal(res.approval.approved_overtime_minutes, 0);
  const after = item();
  assert.equal(after.overtime_hours, 0);
  assert.equal(after.overtime_amount, 0);
  assert.equal(after.gross_pay, gross);
  assert.equal(after.attendance_summary.pending_overtime_count, 0);
  assert.equal(after.status, 'READY');
  assert.equal(run().summary.review_required_count, 0);
});

test('Overtime review never mutates a LOCKED payroll run', async () => {
  const { db, item, run } = await setupOvertimeDraft();
  run().status = 'LOCKED';
  const snapshot = JSON.stringify(item());
  const summarySnapshot = JSON.stringify(run().summary);

  const res = await reviewOvertimeApproval(db, {
    approvalId: 'ot-1', status: 'APPROVED', approvedMinutes: 120, userEmail: 'manager@redbox.id',
  });

  assert.equal(res.approval.status, 'APPROVED'); // the approval itself is still recorded
  assert.deepEqual(res.recalculation.updated, []);
  assert.equal(JSON.stringify(item()), snapshot);
  assert.equal(JSON.stringify(run().summary), summarySnapshot);
});

// ---------------------------------------------------------------------------
// syncOvertimeCandidates must not leave DRAFT snapshots stale
// ---------------------------------------------------------------------------
async function setupSyncDraft({ overtimeDate = '2026-09-02' } = {}) {
  const dates = [];
  for (let d = 26; d <= 31; d++) dates.push('2026-08-' + d);
  for (let d = 1; d <= 14; d++) dates.push('2026-09-' + String(d).padStart(2, '0'));
  const attendance = dates.map((date) => ({
    employee_id: 'emp-ot', attendance_date: date, status: 'hadir', late_minutes: 0, overtime_minutes: 0,
    first_check_in: '08:00', last_check_out: '17:00',
  }));
  const db = createMockDb({
    employees: [{
      id: 'emp-ot', name: 'Overtime Tester', nickname: 'OT', business_unit: 'Redbox', branch: 'bypass',
      position: 'Staff', base_salary: 3000000, position_allowance: 0, meal_allowance_rate: 0, is_active: true,
    }],
    employee_attendance: attendance,
  });
  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-08-26', periodEnd: '2026-09-25', businessUnit: 'ALL', userEmail: 'test@redbox.id',
  });
  // Overtime shows up in attendance AFTER the draft was generated (or lies outside its period)
  let row = db.tables.employee_attendance.find((r) => r.attendance_date === overtimeDate);
  if (!row) {
    row = {
      employee_id: 'emp-ot', attendance_date: overtimeDate, status: 'hadir', late_minutes: 0, overtime_minutes: 0,
      first_check_in: '08:00', last_check_out: '19:00',
    };
    db.tables.employee_attendance.push(row);
  }
  row.overtime_minutes = 120;
  const item = () => db.tables.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id);
  const run = () => db.tables.payroll_runs.find((r) => r.id === draft.run_id);
  return { db, draft, item, run };
}

test('Overtime sync: new PENDING candidate after draft -> item REVIEW_REQUIRED, pending=1, summary refreshed', async () => {
  const { db, item, run } = await setupSyncDraft();
  assert.equal(item().status, 'READY');
  assert.equal(item().attendance_summary.pending_overtime_count, 0);
  assert.equal(run().summary.review_required_count, 0);
  const gross = item().gross_pay;

  const res = await syncOvertimeCandidates(db, {});

  assert.equal(res.newly_created, 1);
  assert.equal(db.tables.employee_overtime_approvals.length, 1);
  assert.equal(db.tables.employee_overtime_approvals[0].status, 'PENDING');
  assert.equal(res.recalculation.error, null);
  assert.equal(item().attendance_summary.pending_overtime_count, 1);
  assert.equal(item().status, 'REVIEW_REQUIRED');
  assert.ok(item().warnings.some((w) => /lembur menunggu persetujuan/.test(w)));
  assert.equal(item().gross_pay, gross, 'no overtime value until APPROVED');
  assert.equal(item().overtime_amount, 0);
  assert.equal(run().summary.review_required_count, 1);
});

test('Overtime sync: re-sync is idempotent (no duplicate approval, snapshot stays consistent)', async () => {
  const { db, item, run } = await setupSyncDraft();
  await syncOvertimeCandidates(db, {});
  const grossBefore = item().gross_pay;

  const res = await syncOvertimeCandidates(db, {});

  assert.equal(res.newly_created, 0);
  assert.equal(db.tables.employee_overtime_approvals.length, 1);
  assert.equal(item().attendance_summary.pending_overtime_count, 1);
  assert.equal(item().status, 'REVIEW_REQUIRED');
  assert.equal(run().summary.review_required_count, 1);
  assert.equal(item().gross_pay, grossBefore);
});

test('Overtime sync: an already-PENDING candidate whose draft is stale gets re-snapshotted', async () => {
  const { db, item } = await setupSyncDraft();
  db.tables.employee_overtime_approvals.push({
    id: 'ot-pre', employee_id: 'emp-ot', attendance_date: '2026-09-02', raw_overtime_minutes: 120,
    approved_overtime_minutes: 0, status: 'PENDING',
  }); // created before this fix, draft never learned about it
  assert.equal(item().status, 'READY');

  const res = await syncOvertimeCandidates(db, {});

  assert.equal(res.newly_created, 0);
  assert.equal(item().status, 'REVIEW_REQUIRED');
  assert.equal(item().attendance_summary.pending_overtime_count, 1);
});

test('Overtime sync: LOCKED run is never changed and the anomaly is reported', async () => {
  const { db, item, run } = await setupSyncDraft();
  run().status = 'LOCKED';
  const itemSnap = JSON.stringify(item());
  const summarySnap = JSON.stringify(run().summary);

  const res = await syncOvertimeCandidates(db, {});

  // LOCKED payroll is immutable: no candidate is created for its period, the anomaly is reported instead
  assert.equal(res.success, true);
  assert.equal(res.newly_created, 0);
  assert.equal(db.tables.employee_overtime_approvals.length, 0);
  assert.deepEqual(res.recalculation.updated, []);
  assert.equal(res.locked_run_anomalies.length, 1);
  assert.equal(res.locked_run_anomalies[0].run_id, run().id);
  assert.equal(JSON.stringify(item()), itemSnap);
  assert.equal(JSON.stringify(run().summary), summarySnap);
});

test('Overtime sync: no overlapping DRAFT run -> candidate stored, no payroll mutation', async () => {
  const { db, item, run } = await setupSyncDraft({ overtimeDate: '2026-10-05' }); // outside 2026-08-26..09-25
  const itemSnap = JSON.stringify(item());
  const summarySnap = JSON.stringify(run().summary);

  const res = await syncOvertimeCandidates(db, {});

  assert.equal(res.newly_created, 1);
  assert.deepEqual(res.recalculation.updated, []);
  assert.deepEqual(res.recalculation.locked_run_anomalies, []);
  assert.equal(JSON.stringify(item()), itemSnap);
  assert.equal(JSON.stringify(run().summary), summarySnap);
});

test('Overtime workflow: sync -> PENDING -> approve recalculates pending, amount, gross, take-home, status', async () => {
  const { db, item, run } = await setupSyncDraft();
  const baseGross = item().gross_pay;
  const baseTake = item().take_home_pay;

  await syncOvertimeCandidates(db, {});
  assert.equal(item().attendance_summary.pending_overtime_count, 1);
  assert.equal(item().status, 'REVIEW_REQUIRED');

  const approvalId = db.tables.employee_overtime_approvals[0].id;
  const res = await reviewOvertimeApproval(db, {
    approvalId, status: 'APPROVED', approvedMinutes: 120, userEmail: 'manager@redbox.id',
  });

  assert.equal(res.recalculation.error, null);
  assert.equal(item().attendance_summary.pending_overtime_count, 0);
  assert.equal(item().overtime_hours, 2);
  assert.equal(item().overtime_amount, 15000);
  assert.equal(item().gross_pay, baseGross + 15000);
  assert.equal(item().take_home_pay, baseTake + 15000);
  assert.equal(item().status, 'READY');
  assert.equal(run().summary.review_required_count, 0);
  assert.equal(run().summary.total_gross_pay, item().gross_pay);
});

// ---------------------------------------------------------------------------
// Review round 2 regressions: lock guard, race handling, snapshot authority, raw refresh
// ---------------------------------------------------------------------------
const { lockRegularPayrollRun: lockRun } = require('../services/regularPayrollService');

test('Lock guard: pending overtime approval blocks locking a regular payroll run', async () => {
  const { db, draft, run } = await setupOvertimeDraft(); // draft has one PENDING candidate (120 min)
  run().summary = { ...run().summary, attendance_period_complete: true }; // isolate the overtime rule

  await assert.rejects(
    () => lockRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    /pending overtime approval/i
  );
  assert.equal(run().status, 'DRAFT');
  assert.equal(run().locked_at, undefined);
});

test('Lock guard: once overtime is reviewed and coverage is complete, a valid run locks', async () => {
  const { db, draft, run } = await setupOvertimeDraft();
  await reviewOvertimeApproval(db, { approvalId: 'ot-1', status: 'APPROVED', approvedMinutes: 120, userEmail: 'manager@redbox.id' });
  run().summary = { ...run().summary, attendance_period_complete: true };

  const res = await lockRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' });

  assert.equal(res.status, 'LOCKED');
  assert.equal(run().status, 'LOCKED');
});

test('Lock guard: a PENDING candidate of an employee NOT in the run, or outside the period, does not block', async () => {
  const { db, draft, run } = await setupOvertimeDraft();
  await reviewOvertimeApproval(db, { approvalId: 'ot-1', status: 'REJECTED', userEmail: 'manager@redbox.id' });
  db.tables.employee_overtime_approvals.push(
    { id: 'ot-other', employee_id: 'someone-else', attendance_date: '2026-09-02', raw_overtime_minutes: 60, approved_overtime_minutes: 0, status: 'PENDING' },
    { id: 'ot-outside', employee_id: 'emp-ot', attendance_date: '2026-10-05', raw_overtime_minutes: 60, approved_overtime_minutes: 0, status: 'PENDING' }
  );
  run().summary = { ...run().summary, attendance_period_complete: true };

  const res = await lockRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(res.status, 'LOCKED');
});

test('Race: approval saved but payroll item update rejected (run locked concurrently) is NOT reported as success', async () => {
  const { db, item, run } = await setupOvertimeDraft();
  const itemSnap = JSON.stringify(item());
  const summarySnap = JSON.stringify(run().summary);

  // Simulate the immutability trigger firing on the item update
  const realFrom = db.from.bind(db);
  db.from = (table) => {
    const t = realFrom(table);
    if (table !== 'payroll_regular_items') return t;
    return {
      ...t,
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { message: 'Cannot modify payroll_regular_items: payroll run is LOCKED and immutable' } }),
              maybeSingle: async () => ({ data: null, error: { message: 'Cannot modify payroll_regular_items: payroll run is LOCKED and immutable' } }),
            }),
          }),
          select: () => ({
            single: async () => ({ data: null, error: { message: 'Cannot modify payroll_regular_items: payroll run is LOCKED and immutable' } }),
            maybeSingle: async () => ({ data: null, error: { message: 'Cannot modify payroll_regular_items: payroll run is LOCKED and immutable' } }),
          }),
        }),
      }),
    };
  };

  const res = await reviewOvertimeApproval(db, { approvalId: 'ot-1', status: 'APPROVED', approvedMinutes: 120, userEmail: 'manager@redbox.id' });

  assert.equal(res.approval_saved, true);
  assert.equal(res.recalculation_success, false);
  assert.equal(res.success, false);
  assert.equal(res.recalculation.reason, 'RUN_LOCKED_CONCURRENTLY');
  assert.match(res.recalculation.error, /LOCKED/);
  assert.deepEqual(res.recalculation.updated, []);
  assert.equal(db.tables.employee_overtime_approvals[0].status, 'APPROVED', 'the committed approval is not falsely rolled back');
  assert.equal(JSON.stringify(item()), itemSnap);
  assert.equal(JSON.stringify(run().summary), summarySnap, 'summary must not be refreshed after a failed item update');
});

test('Snapshot authority: recalculation keeps the draft compensation, ignoring later employee master changes', async () => {
  const { db, item } = await setupOvertimeDraft();
  assert.equal(item().base_salary, 3000000);
  const baseGross = item().gross_pay;
  const baseActual = item().actual_salary;

  // Master data changes AFTER the draft was generated
  const emp = db.tables.employees.find((e) => e.id === 'emp-ot');
  emp.base_salary = 4000000;
  emp.position_allowance = 500000;
  emp.meal_allowance_rate = 30000;

  await reviewOvertimeApproval(db, { approvalId: 'ot-1', status: 'APPROVED', approvedMinutes: 120, userEmail: 'manager@redbox.id' });

  assert.equal(item().base_salary, 3000000);
  assert.equal(item().actual_salary, baseActual);
  assert.equal(item().position_allowance, 0);
  assert.equal(item().gross_pay, baseGross + 15000, 'only overtime moved; compensation stayed on the snapshot');
});

test('Sync: existing PENDING candidate raw minutes follow the latest attendance (60 -> 90)', async () => {
  const { db } = await setupSyncDraft();
  db.tables.employee_overtime_approvals.push({
    id: 'ot-pend', employee_id: 'emp-ot', attendance_date: '2026-09-02', raw_overtime_minutes: 60,
    approved_overtime_minutes: 0, status: 'PENDING',
  });
  db.tables.employee_attendance.find((r) => r.attendance_date === '2026-09-02').overtime_minutes = 90;

  const res = await syncOvertimeCandidates(db, {});

  assert.equal(db.tables.employee_overtime_approvals.length, 1, 'no duplicate approval');
  assert.equal(db.tables.employee_overtime_approvals[0].raw_overtime_minutes, 90);
  assert.equal(db.tables.employee_overtime_approvals[0].status, 'PENDING');
  assert.deepEqual(res.raw_refreshed, [{ approval_id: 'ot-pend', from: 60, to: 90 }]);
});

test('Sync: APPROVED / REJECTED decisions are never overwritten by a resync, only reported', async () => {
  const { db } = await setupSyncDraft();
  db.tables.employee_overtime_approvals.push({
    id: 'ot-appr', employee_id: 'emp-ot', attendance_date: '2026-09-02', raw_overtime_minutes: 60,
    approved_overtime_minutes: 60, status: 'APPROVED', approved_by: 'manager@redbox.id',
  });
  db.tables.employee_attendance.find((r) => r.attendance_date === '2026-09-02').overtime_minutes = 90;
  const before = JSON.stringify(db.tables.employee_overtime_approvals[0]);

  const res = await syncOvertimeCandidates(db, {});

  assert.equal(JSON.stringify(db.tables.employee_overtime_approvals[0]), before);
  assert.deepEqual(res.raw_refreshed, []);
  assert.equal(res.decision_discrepancies.length, 1);
  assert.equal(res.decision_discrepancies[0].status, 'APPROVED');
  assert.equal(res.decision_discrepancies[0].attendance_overtime_minutes, 90);

  // same for REJECTED
  db.tables.employee_overtime_approvals[0] = {
    id: 'ot-rej', employee_id: 'emp-ot', attendance_date: '2026-09-02', raw_overtime_minutes: 60,
    approved_overtime_minutes: 0, status: 'REJECTED',
  };
  const before2 = JSON.stringify(db.tables.employee_overtime_approvals[0]);
  await syncOvertimeCandidates(db, {});
  assert.equal(JSON.stringify(db.tables.employee_overtime_approvals[0]), before2);
});

// ---------------------------------------------------------------------------
// Review round 3: unified overtime reconciliation (attendance -> approval -> snapshot -> lock)
// ---------------------------------------------------------------------------
const {
  fetchEmployeeAttendanceSummaries,
  recalculateSingleRegularItem,
  reconcileOvertimeForPeriod,
} = require('../services/regularPayrollService');

async function setupBaseDraft({ overtimeAtDraft = 0, withApproval = null } = {}) {
  const dates = [];
  for (let d = 26; d <= 31; d++) dates.push('2026-08-' + d);
  for (let d = 1; d <= 14; d++) dates.push('2026-09-' + String(d).padStart(2, '0'));
  const db = createMockDb({
    employees: [{
      id: 'emp-ot', name: 'Overtime Tester', nickname: 'OT', business_unit: 'Redbox', branch: 'bypass',
      position: 'Staff', base_salary: 3000000, position_allowance: 0, meal_allowance_rate: 0, is_active: true,
    }],
    employee_attendance: dates.map((date) => ({
      employee_id: 'emp-ot', attendance_date: date, status: 'hadir', late_minutes: 0,
      overtime_minutes: date === '2026-09-02' ? overtimeAtDraft : 0, first_check_in: '08:00', last_check_out: '17:00',
    })),
    employee_overtime_approvals: withApproval ? [withApproval] : [],
  });
  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-08-26', periodEnd: '2026-09-25', businessUnit: 'ALL', userEmail: 'test@redbox.id',
  });
  const item = () => db.tables.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id);
  const run = () => db.tables.payroll_runs.find((r) => r.id === draft.run_id);
  const att = (date) => db.tables.employee_attendance.find((r) => r.attendance_date === date);
  const complete = () => { run().summary = { ...run().summary, attendance_period_complete: true }; };
  return { db, draft, item, run, att, complete };
}

test('Draft generation reconciles attendance overtime first: candidate exists, item REVIEW_REQUIRED (never READY)', async () => {
  const { db, item, run } = await setupBaseDraft({ overtimeAtDraft: 120 });

  assert.equal(db.tables.employee_overtime_approvals.length, 1, 'PENDING candidate created without any manual sync');
  const cand = db.tables.employee_overtime_approvals[0];
  assert.equal(cand.status, 'PENDING');
  assert.equal(cand.raw_overtime_minutes, 120);
  assert.equal(cand.approved_overtime_minutes, 0);
  assert.equal(item().attendance_summary.pending_overtime_count, 1);
  assert.equal(item().status, 'REVIEW_REQUIRED');
  assert.equal(item().overtime_amount, 0);
  assert.equal(run().summary.review_required_count, 1);
});

test('Lock invariant: attendance overtime that was never synced blocks the lock (no approval row)', async () => {
  const { db, draft, item, att, complete } = await setupBaseDraft();
  assert.equal(item().status, 'READY');
  att('2026-09-02').overtime_minutes = 90; // appears after the draft, nobody synced it
  complete();

  await assert.rejects(
    () => lockRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    /attendance overtime row\(s\) have no reviewed approval/
  );
});

test('Race approve -> lock: approval committed but item not recalculated => lock REJECTED, then allowed after recalculation', async () => {
  const { db, draft, item, run, complete } = await setupBaseDraft({ overtimeAtDraft: 120 });
  const apprId = db.tables.employee_overtime_approvals[0].id;
  complete();
  assert.equal(item().attendance_summary.approved_overtime_minutes, 0); // T1 snapshot: overtime 0

  // T2: manager approval is committed (row written) ...
  Object.assign(db.tables.employee_overtime_approvals[0], { status: 'APPROVED', approved_overtime_minutes: 120, raw_overtime_minutes: 120 });
  // T3: ... the recalculation has not happened. T4: owner locks.
  await assert.rejects(
    () => lockRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    /Payroll overtime snapshot is stale/
  );
  assert.equal(run().status, 'DRAFT');

  // After the recalculation the snapshot follows and the lock proceeds
  await recalculateSingleRegularItem(db, draft.run_id, item().id, { refreshOvertime: true });
  assert.equal(item().attendance_summary.approved_overtime_minutes, 120);
  assert.equal(item().overtime_amount, 15000);
  assert.equal(apprId, db.tables.employee_overtime_approvals[0].id);
  complete();
  const res = await lockRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(res.status, 'LOCKED');
});

test('Source correction, APPROVED: 60 -> attendance corrected to 0 => decision kept, discrepancy reported, item REVIEW_REQUIRED, lock REJECTED', async () => {
  const { db, draft, item, att, complete } = await setupBaseDraft({ overtimeAtDraft: 60 });
  await reviewOvertimeApproval(db, { approvalId: db.tables.employee_overtime_approvals[0].id, status: 'APPROVED', approvedMinutes: 60, userEmail: 'manager@redbox.id' });
  assert.equal(item().attendance_summary.approved_overtime_minutes, 60);
  assert.equal(item().status, 'READY');
  complete();

  att('2026-09-02').overtime_minutes = 0; // corrected import
  const before = JSON.stringify(db.tables.employee_overtime_approvals[0]);
  const res = await syncOvertimeCandidates(db, {});

  assert.equal(JSON.stringify(db.tables.employee_overtime_approvals[0]), before, 'human decision is never overwritten');
  assert.equal(res.decision_discrepancies.length, 1);
  assert.equal(res.decision_discrepancies[0].status, 'APPROVED');
  assert.equal(res.decision_discrepancies[0].attendance_overtime_minutes, 0);
  assert.equal(item().status, 'REVIEW_REQUIRED');
  assert.ok(item().warnings.some((w) => /tidak lagi sesuai dengan presensi/.test(w)));
  complete();
  await assert.rejects(
    () => lockRun(db, { runId: draft.run_id, userEmail: 'owner@redbox.id' }),
    /no longer match attendance overtime/
  );
});

test('Source correction, PENDING: attendance 60 -> 0 invalidates the undecided candidate and unblocks the draft', async () => {
  const { db, item, run, att } = await setupBaseDraft({ overtimeAtDraft: 60 });
  assert.equal(item().status, 'REVIEW_REQUIRED');

  att('2026-09-02').overtime_minutes = 0;
  const res = await syncOvertimeCandidates(db, {});

  assert.equal(db.tables.employee_overtime_approvals.length, 0, 'system-generated PENDING candidate removed');
  assert.equal(res.invalidated_pending.length, 1);
  assert.equal(res.invalidated_pending[0].raw_overtime_minutes, 60);
  assert.equal(item().attendance_summary.pending_overtime_count, 0);
  assert.equal(item().status, 'READY');
  assert.equal(run().summary.review_required_count, 0);
});

test('Review: refuses to approve overtime the attendance no longer reports; raw follows the current source', async () => {
  const { db, att } = await setupBaseDraft({ overtimeAtDraft: 60 });
  const id = db.tables.employee_overtime_approvals[0].id;

  att('2026-09-02').overtime_minutes = 0;
  await assert.rejects(
    () => reviewOvertimeApproval(db, { approvalId: id, status: 'APPROVED', approvedMinutes: 60, userEmail: 'manager@redbox.id' }),
    /tidak lagi melaporkan lembur/
  );

  att('2026-09-02').overtime_minutes = 90;
  await reviewOvertimeApproval(db, { approvalId: id, status: 'APPROVED', approvedMinutes: 90, userEmail: 'manager@redbox.id' });
  assert.equal(db.tables.employee_overtime_approvals[0].raw_overtime_minutes, 90);
});

test('Reconciliation helper: covers both sides (attendance rows AND existing approvals)', async () => {
  const { db } = await setupBaseDraft();
  db.tables.employee_attendance.find((r) => r.attendance_date === '2026-08-27').overtime_minutes = 30;        // A: missing -> create
  db.tables.employee_overtime_approvals.push(
    { id: 'p-stale', employee_id: 'emp-ot', attendance_date: '2026-08-28', raw_overtime_minutes: 45, approved_overtime_minutes: 0, status: 'PENDING' }, // C: source 0 -> invalidate
    { id: 'a-src', employee_id: 'emp-ot', attendance_date: '2026-08-29', raw_overtime_minutes: 20, approved_overtime_minutes: 20, status: 'APPROVED' }   // D: source 0 -> discrepancy
  );

  const r = await reconcileOvertimeForPeriod(db, { periodStart: '2026-08-26', periodEnd: '2026-09-25', employeeIds: ['emp-ot'] });

  assert.equal(r.created.length, 1);
  assert.equal(r.invalidated.length, 1);
  assert.equal(r.invalidated[0].approval_id, 'p-stale');
  assert.equal(r.decision_discrepancies.length, 1);
  assert.equal(r.decision_discrepancies[0].approval_id, 'a-src');
  assert.ok(db.tables.employee_overtime_approvals.some((a) => a.id === 'a-src' && a.status === 'APPROVED'));
  assert.ok(!db.tables.employee_overtime_approvals.some((a) => a.id === 'p-stale'));
});

// ---- approval reads must page (PostgREST 1000-row cap) and fail closed ----
function cappedSupabase(tables) {
  const CAP = 1000;
  const make = (name) => {
    const rows = tables[name] || [];
    const f = [];
    const order = [];
    let win = null;
    const api = {
      select() { return api; },
      in(c, v) { f.push((r) => v.includes(r[c])); return api; },
      eq(c, v) { f.push((r) => r[c] === v); return api; },
      gt(c, v) { f.push((r) => r[c] > v); return api; },
      gte(c, v) { f.push((r) => r[c] >= v); return api; },
      lte(c, v) { f.push((r) => r[c] <= v); return api; },
      order(c) { order.push(c); return api; },
      range(a, b) { win = [a, b]; return api; },
      then(res) {
        let out = rows.filter((r) => f.every((x) => x(r)));
        if (order.length) out = [...out].sort((a, b) => order.reduce((acc, c) => acc || String(a[c]).localeCompare(String(b[c])), 0));
        out = win ? out.slice(win[0], win[1] + 1) : out;
        res({ data: out.slice(0, CAP), error: null });
      },
    };
    return api;
  };
  return { from: make };
}

test('Approval paging: >1000 approvals in the period, target on page 2 -> approved minutes and pending count still counted', async () => {
  const ids = [];
  const approvals = [];
  for (let i = 0; i < 1100; i++) {
    const id = 'e-' + String(i).padStart(4, '0');
    ids.push(id);
    approvals.push({ id: 'a-' + id, employee_id: id, attendance_date: '2026-09-01', raw_overtime_minutes: 30, approved_overtime_minutes: 0, status: 'PENDING' });
  }
  ids.push('zz-target');
  approvals.push({ id: 'a-zz', employee_id: 'zz-target', attendance_date: '2026-09-01', raw_overtime_minutes: 120, approved_overtime_minutes: 120, status: 'APPROVED' });
  approvals.push({ id: 'a-zz2', employee_id: 'zz-target', attendance_date: '2026-09-02', raw_overtime_minutes: 45, approved_overtime_minutes: 0, status: 'PENDING' });
  const attendance = [
    { employee_id: 'zz-target', attendance_date: '2026-09-01', status: 'hadir', overtime_minutes: 120, first_check_in: '08:00', last_check_out: '19:00' },
    { employee_id: 'zz-target', attendance_date: '2026-09-02', status: 'hadir', overtime_minutes: 45, first_check_in: '08:00', last_check_out: '18:00' },
  ];
  const sb = cappedSupabase({ employee_attendance: attendance, employee_overtime_approvals: approvals, attendance_exceptions: [] });
  // give every synthetic employee a matching attendance overtime so only page position matters
  for (let i = 0; i < 1100; i++) attendance.push({ employee_id: 'e-' + String(i).padStart(4, '0'), attendance_date: '2026-09-01', status: 'hadir', overtime_minutes: 30, first_check_in: '08:00', last_check_out: '17:30' });

  const map = await fetchEmployeeAttendanceSummaries(sb, ids, '2026-08-26', '2026-09-25', new Map());

  const t = map.get('zz-target');
  assert.equal(t.approved_overtime_minutes, 120, 'approved minutes from page 2 counted');
  assert.equal(t.pending_overtime_count, 1, 'pending count from page 2 counted');
  assert.equal(t.overtime_discrepancy_count, 0);
  assert.equal(map.get('e-0000').pending_overtime_count, 1);
});

test('Approval paging: a failed approvals/attendance read fails closed instead of looking like "no overtime"', async () => {
  const failing = (badTable) => ({ from: (name) => {
    const api = {
      select() { return api; }, in() { return api; }, eq() { return api; }, gt() { return api; }, gte() { return api; }, lte() { return api; }, order() { return api; },
      then(res) { res(name === badTable ? { data: null, error: { message: 'boom' } } : { data: [], error: null }); },
    };
    return api;
  } });
  await assert.rejects(() => fetchEmployeeAttendanceSummaries(failing('employee_overtime_approvals'), ['e1'], '2026-08-26', '2026-09-25', new Map()), /employee_overtime_approvals/);
  await assert.rejects(() => fetchEmployeeAttendanceSummaries(failing('employee_attendance'), ['e1'], '2026-08-26', '2026-09-25', new Map()), /employee_attendance/);
});
