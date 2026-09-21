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
          return {
            eq(col, val) {
              const target = rows.find((r) => r[col] === val);

              // Immutability trigger simulation for payroll_regular_items
              if (table === 'payroll_regular_items' && target) {
                const run = tables.payroll_runs.find((r) => r.id === target.payroll_run_id);
                if (run && run.status === 'LOCKED') {
                  const err = new Error('Cannot modify payroll_regular_items: payroll run is LOCKED and immutable');
                  return {
                    single: async () => ({ data: null, error: err }),
                    then(resolve) {
                      resolve({ data: null, error: err });
                    },
                  };
                }
              }

              // Immutability trigger simulation for payroll_runs
              if (table === 'payroll_runs' && target) {
                if (target.status === 'LOCKED') {
                  const err = new Error('Cannot modify payroll run: run is LOCKED and immutable');
                  return {
                    single: async () => ({ data: null, error: err }),
                    then(resolve) {
                      resolve({ data: null, error: err });
                    },
                  };
                }
              }

              if (target) {
                Object.assign(target, updates, { updated_at: new Date().toISOString() });
              }
              return {
                select: () => ({
                  single: async () => ({ data: target || null, error: null }),
                }),
                single: async () => ({ data: target || null, error: null }),
                then(resolve) {
                  resolve({ data: target, error: null });
                },
              };
            },
          };
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
const { reviewOvertimeApproval } = require('../services/regularPayrollService');

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
      employee_id: 'emp-ot', attendance_date: date, status: 'hadir', late_minutes: 0, overtime_minutes: 0,
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
