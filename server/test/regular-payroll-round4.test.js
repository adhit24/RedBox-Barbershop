'use strict';

/**
 * Round-4 review regressions:
 *  - approved overtime minutes validation (service + route)
 *  - branch-scoped approval listing is page-safe
 *  - overtime sync reports failures as failures
 *  - adjustment ownership is validated server-side
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createInMemorySupabase } = require('./helpers/inMemorySupabase');
const { createRegularPayrollRoutes } = require('../routes/regularPayroll');
const {
  generateRegularPayrollDraft,
  reviewOvertimeApproval,
  syncOvertimeCandidates,
  addRegularPayrollAdjustment,
  listOvertimeApprovals,
} = require('../services/regularPayrollService');

const DATES = [];
for (let d = 26; d <= 31; d++) DATES.push('2026-08-' + d);
for (let d = 1; d <= 14; d++) DATES.push('2026-09-' + String(d).padStart(2, '0'));

function baseStore(overtimeOn = '2026-09-02', overtimeMinutes = 120) {
  return {
    employees: [
      { id: 'emp-a', name: 'Alpha Bypass', nickname: 'A', business_unit: 'Redbox', branch: 'bypass', position: 'Staff', base_salary: 3000000, position_allowance: 0, meal_allowance_rate: 0, is_active: true },
      { id: 'emp-b', name: 'Beta CSB', nickname: 'B', business_unit: 'Redbox', branch: 'csb', position: 'Staff', base_salary: 2000000, position_allowance: 0, meal_allowance_rate: 0, is_active: true },
    ],
    employee_attendance: ['emp-a', 'emp-b'].flatMap((id) => DATES.map((date) => ({
      employee_id: id, attendance_date: date, status: 'hadir', late_minutes: 0,
      overtime_minutes: date === overtimeOn && overtimeMinutes ? overtimeMinutes : 0, first_check_in: '08:00', last_check_out: '17:00',
    }))),
    employee_overtime_approvals: [],
    payroll_runs: [],
    payroll_regular_items: [],
    payroll_adjustments: [],
  };
}

async function draftOf(store, failOn = {}) {
  const db = createInMemorySupabase(store, { failOn });
  const draft = await generateRegularPayrollDraft(db, {
    periodStart: '2026-08-26', periodEnd: '2026-09-25', businessUnit: 'ALL', userEmail: 'test@redbox.id',
  });
  return { db, draft };
}

const approvalOf = (store, empId) => store.employee_overtime_approvals.find((a) => a.employee_id === empId);

// ---------------------------------------------------------------- P1: approved minutes validation
for (const [label, value] of [['-60', -60], ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['"abc"', 'abc'], ['empty string', ''], ['null', null], ['boolean', true]]) {
  test(`Approved minutes ${label} is rejected (no write, no payroll change)`, async () => {
    const store = baseStore();
    const { db } = await draftOf(store);
    const ap = approvalOf(store, 'emp-a');
    const before = JSON.stringify(ap);
    const itemBefore = JSON.stringify(store.payroll_regular_items.find((i) => i.employee_id === 'emp-a'));

    await assert.rejects(
      () => reviewOvertimeApproval(db, { approvalId: ap.id, status: 'APPROVED', approvedMinutes: value, userEmail: 'm@redbox.id' }),
      (err) => err.code === 'INVALID_OVERTIME_MINUTES'
    );
    assert.equal(JSON.stringify(approvalOf(store, 'emp-a')), before);
    assert.equal(JSON.stringify(store.payroll_regular_items.find((i) => i.employee_id === 'emp-a')), itemBefore);
  });
}

test('Approved minutes 120, "90" and an explicit 0 are valid', async () => {
  for (const [input, expected] of [[120, 120], ['90', 90], [0, 0]]) {
    const store = baseStore();
    const { db } = await draftOf(store);
    const ap = approvalOf(store, 'emp-a');
    const res = await reviewOvertimeApproval(db, { approvalId: ap.id, status: 'APPROVED', approvedMinutes: input, userEmail: 'm@redbox.id' });
    assert.equal(res.approval.approved_overtime_minutes, expected);
    assert.equal(res.recalculation_success, true);
  }
});

test('Negative overtime can no longer reach payroll: amount stays >= 0 for every accepted input', async () => {
  const store = baseStore();
  const { db } = await draftOf(store);
  const ap = approvalOf(store, 'emp-a');
  await reviewOvertimeApproval(db, { approvalId: ap.id, status: 'APPROVED', approvedMinutes: 0, userEmail: 'm@redbox.id' });
  assert.ok(store.payroll_regular_items.every((i) => i.overtime_amount >= 0 && i.overtime_hours >= 0));
});

// ---------------------------------------------------------------- HTTP helper
async function withServer(store, opts, fn) {
  const supabase = createInMemorySupabase(store, opts);
  const testAuth = (req, res, next) => {
    req.adminAuth = { role: req.get('x-role'), branch: req.get('x-branch') || null, email: 'tester@redbox.id' };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/api/payroll/regular-runs', createRegularPayrollRoutes(supabase, null, { adminAuth: testAuth }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/api/payroll/regular-runs`;
  const call = async (method, path, { role, branch, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-role': role || '', ...(branch ? { 'x-branch': branch } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try { await fn(call, supabase); } finally { await new Promise((r) => server.close(r)); }
}

test('Route: invalid approved_minutes -> 400 (and nothing written); valid -> 200', async () => {
  const store = baseStore();
  await draftOf(store);
  const ap = approvalOf(store, 'emp-a');
  await withServer(store, {}, async (call) => {
    for (const bad of [-60, 'abc', 'Infinity']) {
      const r = await call('POST', `/overtime/approvals/${ap.id}/review`, { role: 'owner', body: { status: 'APPROVED', approved_minutes: bad } });
      assert.equal(r.status, 400, `approved_minutes=${JSON.stringify(bad)}`);
    }
    assert.equal(approvalOf(store, 'emp-a').status, 'PENDING');
    const ok = await call('POST', `/overtime/approvals/${ap.id}/review`, { role: 'owner', body: { status: 'APPROVED', approved_minutes: 120 } });
    assert.equal(ok.status, 200);
  });
});

// ---------------------------------------------------------------- P2: branch-scoped listing is page-safe
test('Branch-scoped listing reads every page: >1000 approvals, own-branch rows after page 1 are all returned, none of other branches', async () => {
  const store = { employees: [], employee_overtime_approvals: [], payroll_runs: [], payroll_regular_items: [] };
  const days = Array.from({ length: 20 }, (_, i) => '2026-09-' + String(i + 1).padStart(2, '0'));
  // 60 bypass employees x 20 days = 1200 rows (> 1000 cap) + CSB rows that sort before AND after
  for (let e = 0; e < 60; e++) {
    const id = 'emp-b-' + String(e).padStart(3, '0');
    store.employees.push({ id, name: id, branch: 'bypass', business_unit: 'Redbox', position: 'Staff' });
    for (const d of days) store.employee_overtime_approvals.push({ id: `${id}-${d}`, employee_id: id, attendance_date: d, raw_overtime_minutes: 30, approved_overtime_minutes: 0, status: 'PENDING' });
  }
  for (const id of ['emp-a-csb', 'emp-z-csb']) {
    store.employees.push({ id, name: id, branch: 'csb', business_unit: 'Redbox', position: 'Staff' });
    store.employee_overtime_approvals.push({ id: id + '-x', employee_id: id, attendance_date: '2026-09-05', raw_overtime_minutes: 30, approved_overtime_minutes: 0, status: 'PENDING' });
  }
  await withServer(store, {}, async (call) => {
    const r = await call('GET', '/overtime/approvals', { role: 'manager', branch: 'bypass' });
    assert.equal(r.status, 200);
    assert.equal(r.json.approvals.length, 1200, 'every bypass approval, including those after page 1');
    assert.ok(r.json.approvals.every((a) => a.employees.branch === 'bypass'), 'no other-branch rows');
    assert.equal(new Set(r.json.approvals.map((a) => a.id)).size, 1200, 'no duplicates across pages');
    assert.ok(store.__ranged && store.__ranged.includes('employee_overtime_approvals'), 'lookup paged with range()');

    const csb = await call('GET', '/overtime/approvals', { role: 'manager', branch: 'csb' });
    assert.equal(csb.json.approvals.length, 2);
    const owner = await call('GET', '/overtime/approvals', { role: 'owner' });
    assert.equal(owner.json.approvals.length, 1202, 'owner sees all pages too');
  });
});

test('Branch-scoped listing: a manager cannot widen scope by asking for another branch employee_id', async () => {
  const store = baseStore();
  await draftOf(store);
  const db = createInMemorySupabase(store);
  const rows = await listOvertimeApprovals(db, { employeeId: 'emp-b', branchScope: 'bypass' });
  assert.deepEqual(rows, []);
});

// ---------------------------------------------------------------- P2: sync failures are failures
test('Sync: full success -> success:true, no error arrays', async () => {
  const store = baseStore('2026-09-02', 0);
  const { db } = await draftOf(store);
  store.employee_attendance.find((r) => r.employee_id === 'emp-a' && r.attendance_date === '2026-09-03').overtime_minutes = 60;
  const res = await syncOvertimeCandidates(db, {});
  assert.equal(res.success, true);
  assert.equal(res.partial_success, false);
  assert.equal(res.newly_created, 1);
  assert.deepEqual([res.insert_errors, res.update_errors, res.delete_errors, res.recalculation_errors], [[], [], [], []]);
});

test('Sync: insert failure -> success:false with insert_errors', async () => {
  const failOn = {};
  const store = baseStore('2026-09-02', 0);
  const { db } = await draftOf(store, failOn);
  store.employee_attendance.find((r) => r.employee_id === 'emp-a' && r.attendance_date === '2026-09-03').overtime_minutes = 60;
  failOn['employee_overtime_approvals.insert'] = 'duplicate key value violates unique constraint "uq_emp_overtime_approval_date"';

  const res = await syncOvertimeCandidates(db, {});

  assert.equal(res.success, false);
  assert.equal(res.insert_errors.length, 1);
  assert.equal(res.newly_created, 0);
  assert.equal(store.employee_overtime_approvals.length, 0, 'nothing pretended to be synchronized');
});

test('Sync: update failure (refreshing a PENDING raw value) -> success:false with update_errors', async () => {
  const failOn = {};
  const store = baseStore('2026-09-02', 60);
  const { db } = await draftOf(store, failOn);
  store.employee_attendance.find((r) => r.employee_id === 'emp-a' && r.attendance_date === '2026-09-02').overtime_minutes = 90;
  failOn['employee_overtime_approvals.update'] = 'connection reset';

  const res = await syncOvertimeCandidates(db, {});

  assert.equal(res.success, false);
  assert.equal(res.update_errors.length, 1);
  assert.deepEqual(res.raw_refreshed, []);
  assert.equal(approvalOf(store, 'emp-a').raw_overtime_minutes, 60, 'stale raw is reported, not hidden');
});

test('Sync: delete failure (invalidating a stale PENDING) -> success:false with delete_errors', async () => {
  const failOn = {};
  const store = baseStore('2026-09-02', 60);
  const { db } = await draftOf(store, failOn);
  store.employee_attendance.find((r) => r.employee_id === 'emp-a' && r.attendance_date === '2026-09-02').overtime_minutes = 0;
  failOn['employee_overtime_approvals.delete'] = 'permission denied';

  const res = await syncOvertimeCandidates(db, {});

  assert.equal(res.success, false);
  assert.equal(res.delete_errors.length, 1);
  assert.deepEqual(res.invalidated_pending, []);
  assert.ok(approvalOf(store, 'emp-a'), 'the stale candidate is still there: the failure is reported, not hidden');
});

test('Sync: payroll propagation failure -> success:false with recalculation_errors (partial when writes applied)', async () => {
  const failOn = {};
  const store = baseStore('2026-09-02', 0);
  const { db } = await draftOf(store, failOn);
  store.employee_attendance.find((r) => r.employee_id === 'emp-a' && r.attendance_date === '2026-09-03').overtime_minutes = 60;
  failOn['payroll_regular_items.update'] = 'Cannot modify payroll data: payroll run is LOCKED';

  const res = await syncOvertimeCandidates(db, {});

  assert.equal(res.success, false);
  assert.equal(res.partial_success, true, 'the candidate was created even though the draft could not follow');
  assert.equal(res.newly_created, 1);
  assert.equal(res.recalculation_errors.length, 1);
  assert.equal(res.recalculation_errors[0].reason, 'RUN_LOCKED_CONCURRENTLY');
});

test('Route sync: failures are not HTTP 200 (409 for state conflicts, 500 otherwise); success is 200', async () => {
  // conflict (locked / duplicate)
  {
    const failOn = {};
    const store = baseStore('2026-09-02', 0);
    await draftOf(store, failOn);
    store.employee_attendance.find((r) => r.employee_id === 'emp-a' && r.attendance_date === '2026-09-03').overtime_minutes = 60;
    failOn['employee_overtime_approvals.insert'] = 'duplicate key value violates unique constraint';
    await withServer(store, { failOn }, async (call) => {
      const r = await call('POST', '/overtime/sync', { role: 'owner', body: {} });
      assert.equal(r.status, 409);
      assert.equal(r.json.success, false);
      assert.equal(r.json.insert_errors.length, 1);
      assert.match(r.json.error, /gagal|sebagian/i);
    });
  }
  // unexpected persistence failure
  {
    const failOn = {};
    const store = baseStore('2026-09-02', 0);
    await draftOf(store, failOn);
    store.employee_attendance.find((r) => r.employee_id === 'emp-a' && r.attendance_date === '2026-09-03').overtime_minutes = 60;
    failOn['employee_overtime_approvals.insert'] = 'connection reset by peer';
    await withServer(store, { failOn }, async (call) => {
      const r = await call('POST', '/overtime/sync', { role: 'owner', body: {} });
      assert.equal(r.status, 500);
      assert.equal(r.json.success, false);
    });
  }
  // success
  {
    const store = baseStore('2026-09-02', 0);
    await draftOf(store);
    store.employee_attendance.find((r) => r.employee_id === 'emp-a' && r.attendance_date === '2026-09-03').overtime_minutes = 60;
    await withServer(store, {}, async (call) => {
      const r = await call('POST', '/overtime/sync', { role: 'owner', body: {} });
      assert.equal(r.status, 200);
      assert.equal(r.json.success, true);
    });
  }
});

test('Route review: approval write refused because the run is LOCKED -> 409, approval unchanged', async () => {
  const failOn = {};
  const store = baseStore();
  await draftOf(store, failOn);
  const ap = approvalOf(store, 'emp-a');
  failOn['employee_overtime_approvals.update'] = 'Cannot modify overtime approval: employee x on 2026-09-02 belongs to a LOCKED regular payroll run';
  await withServer(store, { failOn }, async (call) => {
    const r = await call('POST', `/overtime/approvals/${ap.id}/review`, { role: 'owner', body: { status: 'APPROVED', approved_minutes: 120 } });
    assert.equal(r.status, 409);
    assert.equal(approvalOf(store, 'emp-a').status, 'PENDING');
  });
});

// ---------------------------------------------------------------- P2: adjustment ownership
async function twoRunStore() {
  const store = baseStore('2026-09-02', 0);
  const { db, draft } = await draftOf(store);
  const itemA = store.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id && i.employee_id === 'emp-a');
  const itemB = store.payroll_regular_items.find((i) => i.payroll_run_id === draft.run_id && i.employee_id === 'emp-b');
  // A second, LOCKED run with its own item
  store.payroll_runs.push({ id: 'run-locked', payroll_type: 'REGULAR', status: 'LOCKED', period_start: '2026-07-26', period_end: '2026-08-25', summary: {} });
  store.payroll_regular_items.push({ ...itemA, id: 'item-locked', payroll_run_id: 'run-locked', status: 'LOCKED' });
  // A non-regular run
  store.payroll_runs.push({ id: 'run-barber', payroll_type: 'BARBER_REVENUE_SHARE', status: 'DRAFT', period_start: '2026-08-26', period_end: '2026-09-25', summary: {} });
  return { store, db, draft, itemA, itemB };
}

const adj = (over) => ({ type: 'BONUS', amount: 50000, reason: 'test', userEmail: 'owner@redbox.id', ...over });

test('Adjustment: an item that belongs to a LOCKED run cannot be attached through a DRAFT run id', async () => {
  const { store, db, draft } = await twoRunStore();
  const before = store.payroll_adjustments.length;
  await assert.rejects(() => addRegularPayrollAdjustment(db, adj({ runId: draft.run_id, payrollRegularItemId: 'item-locked' })), /does not belong to payroll run/);
  assert.equal(store.payroll_adjustments.length, before);
});

test('Adjustment: an item from another (draft) run is rejected; nonexistent item rejected', async () => {
  const { store, db, draft } = await twoRunStore();
  store.payroll_runs.push({ id: 'run-draft-2', payroll_type: 'REGULAR', status: 'DRAFT', period_start: '2026-08-26', period_end: '2026-09-25', summary: {} });
  store.payroll_regular_items.push({ id: 'item-other-draft', payroll_run_id: 'run-draft-2', employee_id: 'emp-a', status: 'READY' });
  await assert.rejects(() => addRegularPayrollAdjustment(db, adj({ runId: draft.run_id, payrollRegularItemId: 'item-other-draft' })), /does not belong to payroll run/);
  await assert.rejects(() => addRegularPayrollAdjustment(db, adj({ runId: draft.run_id, payrollRegularItemId: 'nope' })), /does not belong to payroll run/);
  assert.equal(store.payroll_adjustments.length, 0);
});

test('Adjustment: LOCKED run, non-REGULAR run and locked item are rejected', async () => {
  const { store, db } = await twoRunStore();
  await assert.rejects(() => addRegularPayrollAdjustment(db, adj({ runId: 'run-locked', payrollRegularItemId: 'item-locked' })), /LOCKED/);
  store.payroll_regular_items.push({ id: 'item-barber', payroll_run_id: 'run-barber', employee_id: 'emp-a', status: 'READY' });
  await assert.rejects(() => addRegularPayrollAdjustment(db, adj({ runId: 'run-barber', payrollRegularItemId: 'item-barber' })), /not a REGULAR/);
  const draftRun = store.payroll_runs.find((r) => r.status === 'DRAFT' && r.payroll_type === 'REGULAR');
  store.payroll_regular_items.push({ id: 'item-frozen', payroll_run_id: draftRun.id, employee_id: 'emp-a', status: 'LOCKED' });
  await assert.rejects(() => addRegularPayrollAdjustment(db, adj({ runId: draftRun.id, payrollRegularItemId: 'item-frozen' })), /item is LOCKED/);
  assert.equal(store.payroll_adjustments.length, 0);
});

test('Adjustment: employee mismatch is rejected; without employeeId the employee is derived from the item', async () => {
  const { store, db, draft, itemA } = await twoRunStore();
  await assert.rejects(() => addRegularPayrollAdjustment(db, adj({ runId: draft.run_id, payrollRegularItemId: itemA.id, employeeId: 'emp-b' })), /does not match the payroll item/);
  assert.equal(store.payroll_adjustments.length, 0);

  const res = await addRegularPayrollAdjustment(db, adj({ runId: draft.run_id, payrollRegularItemId: itemA.id })); // no employeeId
  assert.equal(res.adjustment.employee_id, 'emp-a', 'derived from the item');
  assert.equal(res.adjustment.payroll_run_id, draft.run_id);

  const ok = await addRegularPayrollAdjustment(db, adj({ runId: draft.run_id, payrollRegularItemId: itemA.id, employeeId: 'emp-a' }));
  assert.equal(ok.adjustment.employee_id, 'emp-a');
});

test('Route adjustments: employee_id is optional, cross-run item -> 400, valid -> 201', async () => {
  const { store, draft, itemA } = await twoRunStore();
  await withServer(store, {}, async (call) => {
    const cross = await call('POST', `/${draft.run_id}/adjustments`, { role: 'owner', body: { payroll_regular_item_id: 'item-locked', type: 'BONUS', amount: 1000, reason: 'x' } });
    assert.equal(cross.status, 400);
    const ok = await call('POST', `/${draft.run_id}/adjustments`, { role: 'owner', body: { payroll_regular_item_id: itemA.id, type: 'BONUS', amount: 1000, reason: 'x' } });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.adjustment.employee_id, 'emp-a');
    const mism = await call('POST', `/${draft.run_id}/adjustments`, { role: 'owner', body: { payroll_regular_item_id: itemA.id, employee_id: 'emp-b', type: 'BONUS', amount: 1000, reason: 'x' } });
    assert.equal(mism.status, 400);
  });
});
