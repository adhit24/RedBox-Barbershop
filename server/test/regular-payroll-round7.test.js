'use strict';

/**
 * Round-7 review regressions (P1-3, P1-4):
 *  - any payroll-relevant employee_attendance change marks DRAFT items attendance_dirty (not only overtime)
 *  - a dirty item cannot be locked; recalculation re-reads attendance and clears the marker
 *  - LOCKED runs are never mutated (anomaly is recorded)
 *  - unreadable attendance_exceptions abort draft generation / recalculation (fail closed)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createInMemorySupabase } = require('./helpers/inMemorySupabase');
const {
  generateRegularPayrollDraft,
  recalculateSingleRegularItem,
  recalculateRegularPayrollRun,
  lockRegularPayrollRun,
  fetchEmployeeAttendanceSummaries,
} = require('../services/regularPayrollService');

const DATES = [];
for (let d = 26; d <= 31; d++) DATES.push('2026-08-' + d);
for (let d = 1; d <= 14; d++) DATES.push('2026-09-' + String(d).padStart(2, '0'));

function baseStore() {
  return {
    employees: [
      { id: 'emp-a', name: 'Alpha', nickname: 'A', business_unit: 'Redbox', branch: 'bypass', position: 'Staff', base_salary: 3000000, position_allowance: 0, meal_allowance_rate: 0, is_active: true },
      { id: 'emp-b', name: 'Beta', nickname: 'B', business_unit: 'Redbox', branch: 'csb', position: 'Staff', base_salary: 2000000, position_allowance: 0, meal_allowance_rate: 0, is_active: true },
    ],
    employee_attendance: ['emp-a', 'emp-b'].flatMap((id) => DATES.map((date) => ({
      employee_id: id, attendance_date: date, status: 'hadir', late_minutes: 0, overtime_minutes: 0, first_check_in: '08:00', last_check_out: '17:00', raw_punches: ['08:00', '17:00'],
    }))),
    employee_overtime_approvals: [],
    attendance_exceptions: [],
    payroll_runs: [],
    payroll_regular_items: [],
    payroll_adjustments: [],
  };
}

async function draft(failOn = {}) {
  const store = baseStore();
  const db = createInMemorySupabase(store, { failOn });
  const d = await generateRegularPayrollDraft(db, {
    periodStart: '2026-08-26', periodEnd: '2026-09-25', businessUnit: 'ALL', userEmail: 'owner@redbox.id',
  });
  const item = (emp) => store.payroll_regular_items.find((i) => i.payroll_run_id === d.run_id && i.employee_id === emp);
  const run = () => store.payroll_runs.find((r) => r.id === d.run_id);
  const complete = () => { run().summary = { ...run().summary, attendance_period_complete: true }; };
  const setAtt = (emp, date, patch) => db.from('employee_attendance').update(patch).eq('employee_id', emp); // see helper below
  return { store, db, d, item, run, complete, setAtt };
}

// The double's update() filters on ONE column; target one attendance row by giving it a unique key column.
function changeAttendance(store, db, emp, date, patch) {
  const row = store.employee_attendance.find((r) => r.employee_id === emp && r.attendance_date === date);
  row.__k = `${emp}|${date}`;
  return db.from('employee_attendance').update(patch).eq('__k', row.__k);
}

const dirty = (it) => it.attendance_summary?.attendance_dirty === true;

test('late_minutes 0 -> 15 (overtime unchanged) marks the DRAFT item dirty; lock rejected; recalc clears; lock proceeds', async () => {
  const { store, db, item, complete, run } = await draft();
  assert.equal(dirty(item('emp-a')), false);
  const lateBefore = item('emp-a').late_deduction;

  await changeAttendance(store, db, 'emp-a', '2026-09-03', { status: 'terlambat', late_minutes: 15 });
  assert.equal(dirty(item('emp-a')), true, 'marker set in the same write');
  assert.equal(dirty(item('emp-b')), false, 'other employees untouched');

  complete();
  await assert.rejects(() => lockRegularPayrollRun(db, { runId: run().id }), (e) => e.code === 'ATTENDANCE_SNAPSHOT_STALE');
  assert.equal(run().status, 'DRAFT');
  // the database lock RPC is the authority and rejects too
  const rpc = await db.rpc('lock_payroll_run', { p_run_id: run().id, p_user_email: 'x' });
  assert.match(rpc.error.message, /attendance snapshot is stale/);

  const res = await recalculateSingleRegularItem(db, run().id, item('emp-a').id);
  assert.ok(res);
  assert.equal(dirty(item('emp-a')), false, 'recalculation clears the marker');
  assert.equal(item('emp-a').late_count, 1);
  assert.ok(item('emp-a').late_deduction > lateBefore, 'late deduction recomputed from fresh attendance');

  const locked = await lockRegularPayrollRun(db, { runId: run().id });
  assert.equal(run().status, 'LOCKED');
  assert.ok(locked);
});

test('status change and punch correction (overtime 0) mark the item dirty', async () => {
  const { store, db, item } = await draft();
  await changeAttendance(store, db, 'emp-a', '2026-09-04', { status: 'absent' });
  assert.equal(dirty(item('emp-a')), true);
  await recalculateSingleRegularItem(db, item('emp-a').run_id || store.payroll_runs[0].id, item('emp-a').id);
  assert.equal(dirty(item('emp-a')), false);
  assert.equal(item('emp-a').work_days, 19, 'absent day no longer counts as present');

  await changeAttendance(store, db, 'emp-b', '2026-09-05', { last_check_out: null });
  assert.equal(dirty(item('emp-b')), true, 'punch correction alone dirties payroll');
});

test('inserting / deleting an attendance row dirties the item; identical re-import and unrelated metadata do not', async () => {
  const { store, db, item } = await draft();
  // unrelated metadata only
  await changeAttendance(store, db, 'emp-a', '2026-09-06', { raw_punches: ['08:00', '12:00', '17:00'], source: 'fingerprint', updated_at: 'x' });
  assert.equal(dirty(item('emp-a')), false, 'metadata must not dirty payroll');
  // identical value update
  await changeAttendance(store, db, 'emp-a', '2026-09-06', { status: 'hadir', late_minutes: 0 });
  assert.equal(dirty(item('emp-a')), false, 'unchanged relevant values must not dirty payroll');
  // identical re-import (same values)
  await db.from('employee_attendance').insert({ employee_id: 'emp-b', attendance_date: '2026-09-06', status: 'hadir', late_minutes: 0, overtime_minutes: 0, first_check_in: '08:00', last_check_out: '17:00' });
  assert.equal(dirty(item('emp-b')), false);
  // new row for a previously empty day
  await db.from('employee_attendance').insert({ employee_id: 'emp-b', attendance_date: '2026-09-20', status: 'hadir', late_minutes: 0, overtime_minutes: 0, first_check_in: '08:00', last_check_out: '17:00' });
  assert.equal(dirty(item('emp-b')), true);
  // deletion
  await db.from('employee_attendance').update({ __d: 1 }).eq('employee_id', 'nobody');
  const row = store.employee_attendance.find((r) => r.employee_id === 'emp-a' && r.attendance_date === '2026-09-07');
  row.__k = 'del';
  await db.from('employee_attendance').delete().eq('__k', 'del');
  assert.equal(dirty(item('emp-a')), true);
});

test('LOCKED run is immutable: an attendance correction never changes it and is recorded as an anomaly', async () => {
  const { store, db, item, complete, run } = await draft();
  complete();
  await lockRegularPayrollRun(db, { runId: run().id });
  const snapshot = JSON.stringify(item('emp-a'));

  await changeAttendance(store, db, 'emp-a', '2026-09-03', { late_minutes: 45, status: 'terlambat' });
  assert.equal(JSON.stringify(item('emp-a')), snapshot, 'locked item untouched');
  assert.equal(run().status, 'LOCKED');
  assert.equal((store.payroll_attendance_post_lock_anomalies || []).length, 1);
  assert.equal(store.payroll_attendance_post_lock_anomalies[0].employee_id, 'emp-a');

  await assert.rejects(() => recalculateRegularPayrollRun(db, run().id), (e) => e.code === 'RUN_NOT_DRAFT');
});

test('recalculateRegularPayrollRun rebuilds only dirty items unless all=true', async () => {
  const { store, db, item, run } = await draft();
  await changeAttendance(store, db, 'emp-a', '2026-09-03', { status: 'terlambat', late_minutes: 20 });
  const res = await recalculateRegularPayrollRun(db, run().id);
  assert.equal(res.recalculated_count, 1);
  assert.equal(dirty(item('emp-a')), false);
  const all = await recalculateRegularPayrollRun(db, run().id, { all: true });
  assert.equal(all.recalculated_count, 2);
});

// --------------------------------------------------------------------------- P1-4: fail-closed reads
test('ATTENDANCE_EXCEPTIONS_READ_FAILED aborts draft generation before anything is written', async () => {
  const store = baseStore();
  const db = createInMemorySupabase(store, { failOn: { 'attendance_exceptions.select': 'connection reset' } });
  await assert.rejects(
    () => generateRegularPayrollDraft(db, { periodStart: '2026-08-26', periodEnd: '2026-09-25', businessUnit: 'ALL', userEmail: 'owner@redbox.id' }),
    (e) => e.code === 'ATTENDANCE_EXCEPTIONS_READ_FAILED' && /attendance_exceptions/.test(e.message)
  );
  assert.equal(store.payroll_runs.length, 0);
  assert.equal(store.payroll_regular_items.length, 0);
});

test('exceptions read failure during recalculation leaves item and summary unchanged (dirty stays)', async () => {
  const failOn = {};
  const { store, db, item, run } = await draft(failOn);
  await changeAttendance(store, db, 'emp-a', '2026-09-03', { status: 'terlambat', late_minutes: 20 });
  const before = JSON.stringify({ item: item('emp-a'), summary: run().summary });

  failOn['attendance_exceptions.select'] = 'timeout';
  await assert.rejects(
    () => recalculateSingleRegularItem(db, run().id, item('emp-a').id),
    (e) => e.code === 'ATTENDANCE_EXCEPTIONS_READ_FAILED'
  );
  assert.equal(JSON.stringify({ item: item('emp-a'), summary: run().summary }), before);
  assert.equal(dirty(item('emp-a')), true, 'still dirty, so the lock stays blocked');
});

test('a pending exception is counted (REVIEW_REQUIRED) - and an unreadable list is never "no exceptions"', async () => {
  const store = baseStore();
  store.attendance_exceptions.push({ id: 'x1', status: 'pending', attendance_date: '2026-09-02', raw_data: { employee_id: 'emp-a' } });
  const ok = createInMemorySupabase(store);
  const map = await fetchEmployeeAttendanceSummaries(ok, ['emp-a'], '2026-08-26', '2026-09-25', new Map());
  assert.equal(map.get('emp-a').unresolved_exceptions_count, 1);
  const bad = createInMemorySupabase(store, { failOn: { 'attendance_exceptions.select': 'boom' } });
  await assert.rejects(() => fetchEmployeeAttendanceSummaries(bad, ['emp-a'], '2026-08-26', '2026-09-25', new Map()), (e) => e.code === 'ATTENDANCE_EXCEPTIONS_READ_FAILED');
});

test('authoritative reads never become empty data: run summary, item list, run row and lock guards fail closed', async () => {
  const { store, db, item, run, complete } = await draft();
  complete();
  const fails = [
    ['payroll_regular_items.select', /read payroll items|Cannot verify payroll items/],
    ['payroll_runs.select', /read payroll run|Cannot verify payroll run/],
  ];
  for (const [key, re] of fails) {
    const failing = createInMemorySupabase(store, { failOn: { [key]: 'db down' }, emulateTriggers: false });
    await assert.rejects(() => lockRegularPayrollRun(failing, { runId: run().id }), re, `lock guard: ${key}`);
  }
  const failItems = createInMemorySupabase(store, { failOn: { 'payroll_regular_items.select': 'db down' } });
  await assert.rejects(() => recalculateRegularPayrollRun(failItems, run().id), (e) => e.code === 'ITEMS_READ_FAILED');
  const failRun = createInMemorySupabase(store, { failOn: { 'payroll_runs.select': 'db down' } });
  await assert.rejects(() => recalculateRegularPayrollRun(failRun, run().id), (e) => e.code === 'RUN_READ_FAILED');
  assert.equal(run().status, 'DRAFT');
  assert.ok(item('emp-a'));
});
