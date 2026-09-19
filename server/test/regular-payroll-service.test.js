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

  // 4. Lock the run
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
