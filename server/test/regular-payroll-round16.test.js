'use strict';

/**
 * Round-16 regression suite for Codex Round-15 finding PRRT_kwDOSNmW7c6kmvr-.
 * Attendance coverage is run-wide during population reconciliation, and every newly inserted
 * employee is recalculated in the same request before the final run summary is refreshed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createInMemorySupabase } = require('./helpers/inMemorySupabase');
const {
  generateRegularPayrollDraft,
  recalculateRegularPayrollRun,
  lockRegularPayrollRun,
} = require('../services/regularPayrollService');

const PERIOD_START = '2026-08-26';
const PERIOD_END = '2026-09-25';

function employee(id, overrides = {}) {
  return {
    id,
    employee_code: id.toUpperCase(),
    name: `Employee ${id}`,
    nickname: id,
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

function workforce(employees) {
  return {
    employees,
    barbers: [],
    employee_attendance_identity: employees.map((e) => ({
      source: 'fingerprint:bypass',
      external_employee_id: e.id,
      external_name: e.name,
      target_type: 'employee',
      employee_id: e.id,
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

function addEmployee(store, emp) {
  store.employees.push(emp);
  store.employee_attendance_identity.push({
    source: 'fingerprint:bypass',
    external_employee_id: emp.id,
    external_name: emp.name,
    target_type: 'employee',
    employee_id: emp.id,
  });
  store.payroll_attendance_source_versions.push({ employee_id: emp.id, source_revision: 0 });
}

function fillAttendance(store, employeeId, startDate = PERIOD_START, endDate = PERIOD_END) {
  const current = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (current <= end) {
    const date = current.toISOString().slice(0, 10);
    store.employee_attendance.push({
      id: `att-${employeeId}-${date}`,
      employee_id: employeeId,
      attendance_date: date,
      status: 'hadir',
      first_check_in: `${date} 08:00:00`,
      last_check_out: `${date} 17:00:00`,
      late_minutes: 0,
      overtime_minutes: 0,
    });
    current.setUTCDate(current.getUTCDate() + 1);
  }
}

async function createRun() {
  const store = workforce([employee('emp-a')]);
  fillAttendance(store, 'emp-a');
  const supabase = createInMemorySupabase(store);
  const draft = await generateRegularPayrollDraft(supabase, {
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    businessUnit: 'ALL',
    userEmail: 'owner@redbox.id',
  });
  return { store, supabase, runId: draft.run_id };
}

function itemFor(store, runId, employeeId) {
  return store.payroll_regular_items.find(
    (item) => item.payroll_run_id === runId && item.employee_id === employeeId
  );
}

test('partial-attendance new employee uses run-wide Sep 25 cutoff, is recalculated, and cannot lock', async () => {
  const { store, supabase, runId } = await createRun();
  addEmployee(store, employee('emp-b'));
  fillAttendance(store, 'emp-b', PERIOD_START, '2026-09-10');

  const result = await recalculateRegularPayrollRun(supabase, runId);
  const inserted = itemFor(store, runId, 'emp-b');

  assert.deepEqual(result.population.inserted, ['emp-b']);
  assert.equal(result.recalculated_count, 1, 'the clean-looking inserted item must still be recalculated');
  assert.equal(inserted.attendance_summary.attendance_data_through, PERIOD_END);
  assert.equal(inserted.attendance_summary.expected_coverage_days, 31);
  assert.equal(inserted.attendance_summary.records_count, 16);
  assert.equal(inserted.status, 'REVIEW_REQUIRED');
  await assert.rejects(
    () => lockRegularPayrollRun(supabase, { runId, userEmail: 'owner@redbox.id' }),
    /review-required|review required/i
  );

  const run = store.payroll_runs.find((row) => row.id === runId);
  assert.equal(run.summary.total_employees, 2);
  assert.equal(run.summary.review_required_count, 1);
});

test('full-attendance new employee uses run-wide coverage and can become READY', async () => {
  const { store, supabase, runId } = await createRun();
  addEmployee(store, employee('emp-b'));
  fillAttendance(store, 'emp-b');

  const result = await recalculateRegularPayrollRun(supabase, runId);
  const inserted = itemFor(store, runId, 'emp-b');

  assert.equal(result.recalculated_count, 1);
  assert.equal(inserted.attendance_summary.attendance_data_through, PERIOD_END);
  assert.equal(inserted.attendance_summary.expected_coverage_days, 31);
  assert.equal(inserted.status, 'READY');
});

test('mid-period joiner starts expected days at join_date but keeps the run-wide period end', async () => {
  const { store, supabase, runId } = await createRun();
  addEmployee(store, employee('emp-b', { join_date: '2026-09-10' }));
  fillAttendance(store, 'emp-b', '2026-09-10', PERIOD_END);

  await recalculateRegularPayrollRun(supabase, runId);
  const inserted = itemFor(store, runId, 'emp-b');

  assert.equal(inserted.attendance_summary.attendance_data_through, PERIOD_END);
  assert.equal(inserted.attendance_summary.expected_coverage_days, 16);
  assert.equal(inserted.attendance_summary.records_count, 16);
  assert.equal(inserted.status, 'READY');
});

test('NULL join_date remains unknown and does not infer a shortened coverage start', async () => {
  const { store, supabase, runId } = await createRun();
  addEmployee(store, employee('emp-b', { join_date: null }));
  fillAttendance(store, 'emp-b', '2026-09-10', PERIOD_END);

  await recalculateRegularPayrollRun(supabase, runId);
  const inserted = itemFor(store, runId, 'emp-b');

  assert.equal(inserted.attendance_summary.attendance_data_through, PERIOD_END);
  assert.equal(inserted.attendance_summary.expected_coverage_days, 31);
  assert.equal(inserted.status, 'REVIEW_REQUIRED');
});

test('targeted recalculation unions existing dirty employee A with newly inserted employee B', async () => {
  const { store, supabase, runId } = await createRun();
  const existing = itemFor(store, runId, 'emp-a');
  existing.attendance_summary.attendance_dirty = true;
  addEmployee(store, employee('emp-b'));
  fillAttendance(store, 'emp-b');

  const result = await recalculateRegularPayrollRun(supabase, runId, { all: false });

  assert.deepEqual(result.population.inserted, ['emp-b']);
  assert.equal(result.recalculated_count, 2);
  assert.deepEqual(result.items.map((item) => item.employee_id).sort(), ['emp-a', 'emp-b']);
});

test('targeted recalculation with no new population preserves existing behavior and final summary ordering', async () => {
  const { store, supabase, runId } = await createRun();
  const existing = itemFor(store, runId, 'emp-a');
  existing.attendance_summary.attendance_dirty = true;

  const result = await recalculateRegularPayrollRun(supabase, runId, { all: false });
  const run = store.payroll_runs.find((row) => row.id === runId);

  assert.deepEqual(result.population.inserted, []);
  assert.equal(result.recalculated_count, 1);
  assert.equal(result.items[0].employee_id, 'emp-a');
  assert.equal(run.summary.total_employees, 1);
  assert.equal(run.summary.attendance_data_through, PERIOD_END);
  assert.equal(run.summary.attendance_period_complete, true);
});
