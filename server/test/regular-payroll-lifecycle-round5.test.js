'use strict';

/**
 * Round-5 review regressions: run uniqueness, atomic creation, adjustment consistency (write vs lock),
 * fail-closed adjustment reads and compensation authorization.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createInMemorySupabase } = require('./helpers/inMemorySupabase');
const { createRegularPayrollRoutes } = require('../routes/regularPayroll');
const { aggregateAdjustments } = require('../services/regularPayrollEngine');
const {
  generateRegularPayrollDraft,
  addRegularPayrollAdjustment,
  deleteRegularPayrollAdjustment,
  recalculateSingleRegularItem,
  lockRegularPayrollRun,
  evaluateAdjustmentLockInvariants,
} = require('../services/regularPayrollService');

const DATES = [];
for (let d = 26; d <= 31; d++) DATES.push('2026-08-' + d);
for (let d = 1; d <= 14; d++) DATES.push('2026-09-' + String(d).padStart(2, '0'));

function baseStore() {
  return {
    employees: [
      { id: 'emp-a', name: 'Alpha Bypass', nickname: 'A', business_unit: 'Redbox', branch: 'bypass', position: 'Staff', base_salary: 3000000, position_allowance: 0, meal_allowance_rate: 0, is_active: true },
      { id: 'emp-b', name: 'Beta CSB', nickname: 'B', business_unit: 'Redbox', branch: 'csb', position: 'Staff', base_salary: 2000000, position_allowance: 0, meal_allowance_rate: 0, is_active: true },
      { id: 'emp-s', name: 'Sundaze Cook', nickname: 'S', business_unit: 'Sundaze', branch: 'bypass', position: 'Cook', base_salary: 1500000, position_allowance: 0, meal_allowance_rate: 0, is_active: true },
    ],
    employee_attendance: ['emp-a', 'emp-b', 'emp-s'].flatMap((id) => DATES.map((date) => ({
      employee_id: id, attendance_date: date, status: 'hadir', late_minutes: 0, overtime_minutes: 0, first_check_in: '08:00', last_check_out: '17:00',
    }))),
    employee_overtime_approvals: [],
    payroll_runs: [],
    payroll_regular_items: [],
    payroll_adjustments: [],
  };
}

const gen = (db, over = {}) => generateRegularPayrollDraft(db, {
  periodStart: '2026-08-26', periodEnd: '2026-09-25', businessUnit: 'ALL', userEmail: 'owner@redbox.id', ...over,
});

async function draft(opts = {}) {
  const store = baseStore();
  const db = createInMemorySupabase(store, opts);
  const d = await gen(db);
  const item = (emp) => store.payroll_regular_items.find((i) => i.payroll_run_id === d.run_id && i.employee_id === emp);
  const run = () => store.payroll_runs.find((r) => r.id === d.run_id);
  const complete = () => { run().summary = { ...run().summary, attendance_period_complete: true }; };
  return { store, db, d, item, run, complete };
}

// ============================================================ run uniqueness
test('Overlap: a second DRAFT for the same period is rejected (pre-check AND database rpc)', async () => {
  const { store, db } = await draft();
  await assert.rejects(() => gen(db), /overlapping DRAFT run/);
  // the database is authoritative: bypassing the pre-check still fails
  const res = await db.rpc('create_regular_payroll_run', {
    p_header: { business_unit: 'ALL', period_start: '2026-08-26', period_end: '2026-09-25', generated_by: 'x', summary: {} },
    p_items: [{ employee_id: 'emp-a' }],
  });
  assert.match(res.error.message, /Overlapping regular payroll run exists/);
  assert.equal(store.payroll_runs.length, 1);
});

test('Overlap: a LOCKED run also blocks an overlapping period; partial overlap counts', async () => {
  const { store, db, run } = await draft();
  run().status = 'LOCKED';
  await assert.rejects(() => gen(db), /overlapping LOCKED run/);
  await assert.rejects(() => gen(db, { periodStart: '2026-09-20', periodEnd: '2026-10-19' }), /overlapping LOCKED run/);
  assert.equal(store.payroll_runs.length, 1);
});

test('Overlap: a non-overlapping period is allowed', async () => {
  const { store, db } = await draft();
  const second = await gen(db, { periodStart: '2026-09-26', periodEnd: '2026-10-25' });
  assert.ok(second.run_id);
  assert.equal(store.payroll_runs.length, 2);
});

test('Overlap scope: same unit or ALL conflicts; different specific units coexist', async () => {
  const store = baseStore();
  const db = createInMemorySupabase(store);
  await gen(db, { businessUnit: 'Redbox' });
  const sundaze = await gen(db, { businessUnit: 'Sundaze' }); // same period, different unit: allowed
  assert.ok(sundaze.run_id);
  await assert.rejects(() => gen(db, { businessUnit: 'Redbox' }), /overlapping/i);
  await assert.rejects(() => gen(db, { businessUnit: 'ALL' }), /overlapping/i);
  assert.equal(store.payroll_runs.length, 2);
});

test('Concurrent generation cannot create duplicates: the database rejects the loser even when both pre-checks passed', async () => {
  const store = baseStore();
  const db = createInMemorySupabase(store);
  const results = await Promise.allSettled([gen(db), gen(db)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const loser = results.find((r) => r.status === 'rejected');
  assert.match(loser.reason.message, /overlapping|Overlapping/);
  assert.equal(store.payroll_runs.length, 1);
  assert.equal(store.payroll_regular_items.length, 3);
});

// ============================================================ atomic creation
test('Atomic creation: header and every item are committed together', async () => {
  const { store, d, run } = await draft();
  assert.equal(store.payroll_runs.length, 1);
  assert.equal(store.payroll_regular_items.filter((i) => i.payroll_run_id === d.run_id).length, 3);
  assert.equal(d.items_count, 3);
  assert.equal(run().summary.total_employees, 3);
});

test('Atomic creation: an item failure rolls the header back (no run, no items remain)', async () => {
  const store = baseStore();
  const db = createInMemorySupabase(store, { failOn: { 'payroll_regular_items.insert': 'null value in column "position_snapshot" violates not-null constraint' } });
  await assert.rejects(() => gen(db), /Failed to create regular payroll run/);
  assert.equal(store.payroll_runs.length, 0, 'no visible / empty DRAFT survives');
  assert.equal(store.payroll_regular_items.length, 0);
});

test('Empty REGULAR run cannot be created and cannot be locked', async () => {
  const store = baseStore();
  const db = createInMemorySupabase(store);
  const res = await db.rpc('create_regular_payroll_run', { p_header: { period_start: '2026-08-26', period_end: '2026-09-25' }, p_items: [] });
  assert.match(res.error.message, /without payroll items/);
  // legacy / corrupted state: a header with zero items
  store.payroll_runs.push({ id: 'run-empty', payroll_type: 'REGULAR', status: 'DRAFT', business_unit: 'ALL', period_start: '2026-08-26', period_end: '2026-09-25', summary: { attendance_period_complete: true } });
  await assert.rejects(() => lockRegularPayrollRun(db, { runId: 'run-empty', userEmail: 'owner@redbox.id' }), /no payroll items/);
  assert.equal(store.payroll_runs[0].status, 'DRAFT');
});

// ============================================================ adjustment vs lock
const adjOf = (over) => ({ type: 'BONUS', amount: 50000, reason: 'test', userEmail: 'owner@redbox.id', ...over });

test('Race: adjustment INSERT committed, recalculation not yet -> lock REJECTED; after recalculation the lock proceeds', async () => {
  const { store, db, d, item, complete } = await draft();
  complete();
  // T1: the adjustment write commits (database marks the snapshot dirty in the same transaction)
  await db.from('payroll_adjustments').insert({
    payroll_run_id: d.run_id, payroll_regular_item_id: item('emp-a').id, employee_id: 'emp-a', type: 'BONUS', amount: 50000, reason: 'late bonus', created_by: 'o',
  });
  assert.equal(item('emp-a').attendance_summary.adjustments_dirty, true);
  // T2: owner locks before the Node recalculation ran
  await assert.rejects(() => lockRegularPayrollRun(db, { runId: d.run_id, userEmail: 'owner@redbox.id' }), /adjustment snapshot is stale/);
  assert.equal(store.payroll_runs[0].status, 'DRAFT');

  await recalculateSingleRegularItem(db, d.run_id, item('emp-a').id);
  assert.equal(item('emp-a').manual_bonus, 50000);
  assert.equal(item('emp-a').attendance_summary.adjustments_dirty, undefined, 'recalculation clears the dirty marker');
  complete();
  const res = await lockRegularPayrollRun(db, { runId: d.run_id, userEmail: 'owner@redbox.id' });
  assert.equal(res.status, 'LOCKED');
});

test('Race: adjustment DELETE committed, recalculation not yet -> lock REJECTED; after recalculation the lock proceeds', async () => {
  const { store, db, d, item, complete } = await draft();
  const added = await addRegularPayrollAdjustment(db, adjOf({ runId: d.run_id, payrollRegularItemId: item('emp-a').id, type: 'DEDUCTION', amount: 20000 }));
  assert.equal(added.recalculation_success, true);
  assert.equal(item('emp-a').manual_deduction, 20000);
  complete();

  await db.from('payroll_adjustments').delete().eq('id', added.adjustment.id); // committed, not recalculated
  await assert.rejects(() => lockRegularPayrollRun(db, { runId: d.run_id, userEmail: 'owner@redbox.id' }), /adjustment snapshot is stale/);
  assert.equal(store.payroll_runs[0].status, 'DRAFT');

  await recalculateSingleRegularItem(db, d.run_id, item('emp-a').id);
  assert.equal(item('emp-a').manual_deduction, 0);
  complete();
  assert.equal((await lockRegularPayrollRun(db, { runId: d.run_id, userEmail: 'owner@redbox.id' })).status, 'LOCKED');
});

test('Lock backstop: the adjustment aggregate alone (no dirty marker) is enough to reject a stale snapshot', async () => {
  const { store, db, d, item, complete } = await draft({ emulateTriggers: false }); // no trigger => no dirty marker
  complete();
  store.payroll_adjustments.push({ id: 'a1', payroll_run_id: d.run_id, payroll_regular_item_id: item('emp-a').id, employee_id: 'emp-a', type: 'DEBT', amount: 30000 });
  await assert.rejects(() => lockRegularPayrollRun(db, { runId: d.run_id, userEmail: 'owner@redbox.id' }), /adjustment snapshot is stale/);

  await recalculateSingleRegularItem(db, d.run_id, item('emp-a').id);
  assert.equal(item('emp-a').debt_deduction, 30000);
  assert.equal(item('emp-a').adjustments_total, -30000);
  complete();
  assert.equal((await lockRegularPayrollRun(db, { runId: d.run_id, userEmail: 'owner@redbox.id' })).status, 'LOCKED');
});

test('Adjustment aggregate mismatch of any component blocks the lock (bonus / debt / deduction / total)', () => {
  const item = { id: 'i1', employee_name_snapshot: 'X', manual_bonus: 100, debt_deduction: 0, manual_deduction: 0, adjustments_total: 100, attendance_summary: {} };
  const adjs = [{ payroll_regular_item_id: 'i1', type: 'BONUS', amount: 100 }];
  assert.equal(evaluateAdjustmentLockInvariants({ items: [item], adjustments: adjs }), null);
  for (const broken of [{ manual_bonus: 90 }, { debt_deduction: 5 }, { manual_deduction: 5 }, { adjustments_total: 0 }, { attendance_summary: { adjustments_dirty: true } }]) {
    const v = evaluateAdjustmentLockInvariants({ items: [{ ...item, ...broken }], adjustments: adjs });
    assert.equal(v.code, 'ADJUSTMENT_SNAPSHOT_STALE', JSON.stringify(broken));
  }
  assert.equal(evaluateAdjustmentLockInvariants({ items: [item], adjustments: [] }).code, 'ADJUSTMENT_SNAPSHOT_STALE');
});

test('aggregateAdjustments keeps the payroll semantics the lock RPC mirrors (BONUS/DEBT/DEDUCTION/CORRECTION/OTHER)', () => {
  assert.deepEqual(aggregateAdjustments([
    { type: 'BONUS', amount: -500 }, { type: 'bonus ', amount: 200 },
    { type: 'DEBT', amount: -300 }, { type: 'DEDUCTION', amount: 400 },
    { type: 'CORRECTION', amount: 50 }, { type: 'CORRECTION', amount: -70 },
    { type: 'OTHER', amount: 10 }, { type: 'WEIRD', amount: -20 },
  ]), { bonus: 500 + 200 + 50 + 10, debt: 300, deduction: 400 + 70 + 20 });
});

// ============================================================ adjustment read failure: fail closed
test('Adjustment read failure aborts recalculation: no item write, no summary refresh, no success', async () => {
  const failOn = {};
  const { store, db, d, item, run } = await draft({ failOn });
  const itemBefore = JSON.stringify(item('emp-a'));
  const summaryBefore = JSON.stringify(run().summary);
  failOn['payroll_adjustments.select'] = 'connection reset';

  await assert.rejects(
    () => recalculateSingleRegularItem(db, d.run_id, item('emp-a').id),
    (err) => err.code === 'ADJUSTMENTS_READ_FAILED'
  );
  assert.equal(JSON.stringify(item('emp-a')), itemBefore);
  assert.equal(JSON.stringify(run().summary), summaryBefore);

  // through the adjustment workflow: the row was written, but the API must not claim success
  delete failOn['payroll_adjustments.select'];
  const stub = createInMemorySupabase(store, { failOn });
  failOn['payroll_adjustments.select'] = 'connection reset';
  const res = await addRegularPayrollAdjustment(stub, adjOf({ runId: d.run_id, payrollRegularItemId: item('emp-a').id }));
  assert.equal(res.success, false);
  assert.equal(res.adjustment_saved, true);
  assert.equal(res.recalculation_success, false);
  assert.equal(res.reason, 'ADJUSTMENTS_READ_FAILED');
  assert.equal(item('emp-a').manual_bonus, 0, 'snapshot did not silently drop / invent adjustments');
  assert.equal(item('emp-a').attendance_summary.adjustments_dirty, true, 'still marked stale, so the lock refuses it');
});

test('Unreadable item is an error, never a silent no-op recalculation', async () => {
  const { db, d } = await draft();
  await assert.rejects(() => recalculateSingleRegularItem(db, d.run_id, 'missing-item'), (err) => err.code === 'ITEM_READ_FAILED');
});

test('Route: an adjustment whose recalculation failed is not a 201', async () => {
  const failOn = {};
  const { store, d, item } = await draft({ failOn });
  failOn['payroll_adjustments.select'] = 'boom';
  await withServer(store, { failOn }, async (call) => {
    const r = await call('POST', `/${d.run_id}/adjustments`, { role: 'owner', body: { payroll_regular_item_id: item('emp-a').id, type: 'BONUS', amount: 1000, reason: 'x' } });
    assert.equal(r.status, 500);
    assert.equal(r.json.adjustment_saved, true);
    assert.equal(r.json.recalculation_success, false);
  });
});

// ============================================================ authorization of compensation detail
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
    return { status: res.status, text: await res.text() };
  };
  const json = (r) => JSON.parse(r.text);
  try { await fn(async (...a) => { const r = await call(...a); return { ...r, json: (() => { try { return JSON.parse(r.text); } catch (_) { return null; } })() }; }, json); } finally { await new Promise((r) => server.close(r)); }
}

async function payrollWithAdjustments() {
  const ctx = await draft();
  await addRegularPayrollAdjustment(ctx.db, adjOf({ runId: ctx.d.run_id, payrollRegularItemId: ctx.item('emp-b').id, amount: 77777, reason: 'csb-only bonus' }));
  return ctx;
}
const names = (json) => json.items.map((i) => i.employee_name_snapshot).sort();

test('Compensation detail: OWNER sees every item of an ALL run (all units and branches)', async () => {
  const { store, d } = await payrollWithAdjustments();
  await withServer(store, {}, async (call) => {
    const r = await call('GET', `/${d.run_id}`, { role: 'owner' });
    assert.equal(r.status, 200);
    assert.deepEqual(names(r.json), ['Alpha Bypass', 'Beta CSB', 'Sundaze Cook']);
    assert.equal(r.json.run.summary.total_employees, 3);
  });
});

test('Compensation detail: manager Bypass sees Bypass items only (incl. Sundaze of Bypass) - no CSB salary, adjustment or total leaks', async () => {
  const { store, d } = await payrollWithAdjustments();
  await withServer(store, {}, async (call) => {
    const r = await call('GET', `/${d.run_id}`, { role: 'manager', branch: 'bypass' });
    assert.equal(r.status, 200);
    assert.deepEqual(names(r.json), ['Alpha Bypass', 'Sundaze Cook']);
    assert.equal(r.json.run.summary.total_employees, 2, 'summary is recomputed from visible items only');
    assert.equal(r.json.run.summary.scoped_to_branch, true);
    for (const leak of ['Beta CSB', 'csb-only bonus', '77777', 'emp-b']) {
      assert.ok(!r.text.includes(leak), `must not expose: ${leak}`);
    }
    assert.ok(r.json.items.every((i) => i.base_salary !== 2000000), 'CSB base salary is not exposed');
    const gross = r.json.items.reduce((s, i) => s + Number(i.gross_pay), 0);
    assert.equal(r.json.run.summary.total_gross_pay, gross);
  });
});

test('Compensation detail: manager CSB vice versa; the direct run id of an ALL run does not widen scope', async () => {
  const { store, d } = await payrollWithAdjustments();
  await withServer(store, {}, async (call) => {
    const r = await call('GET', `/${d.run_id}`, { role: 'manager', branch: 'CSB' });
    assert.equal(r.status, 200);
    assert.deepEqual(names(r.json), ['Beta CSB']);
    assert.ok(r.text.includes('csb-only bonus'), 'own-branch adjustment is visible');
    assert.ok(!r.text.includes('Alpha Bypass') && !r.text.includes('Sundaze Cook'));
    // filters / query strings cannot widen the scope; the branch is never read from the request
    const q = await call('GET', `/${d.run_id}?branch=bypass&business_unit=all&status=all`, { role: 'manager', branch: 'csb' });
    assert.deepEqual(names(q.json), ['Beta CSB']);
  });
});

test('Compensation detail: no branch / branch_admin / unknown role fail closed (403) on list and detail', async () => {
  const { store, d } = await payrollWithAdjustments();
  await withServer(store, {}, async (call) => {
    for (const who of [{ role: 'manager' }, { role: 'branch_admin', branch: 'bypass' }, { role: 'cashier', branch: 'bypass' }, { role: '' }]) {
      assert.equal((await call('GET', `/${d.run_id}`, who)).status, 403, JSON.stringify(who));
      assert.equal((await call('GET', '/', who)).status, 403, JSON.stringify(who));
    }
  });
});

test('Run list: manager gets runs with a branch-scoped summary; owner gets the full summary', async () => {
  const { store } = await payrollWithAdjustments();
  await withServer(store, {}, async (call) => {
    const owner = await call('GET', '/', { role: 'owner' });
    assert.equal(owner.json.runs[0].summary.total_employees, 3);
    const m = await call('GET', '/', { role: 'manager', branch: 'csb' });
    assert.equal(m.json.runs[0].summary.total_employees, 1);
    assert.equal(m.json.runs[0].summary.scoped_to_branch, true);
    assert.ok(m.json.runs[0].summary.total_gross_pay < owner.json.runs[0].summary.total_gross_pay);
  });
});

test('Adjustment writes remain owner-only', async () => {
  const { store, d, item } = await draft();
  await withServer(store, {}, async (call) => {
    const r = await call('POST', `/${d.run_id}/adjustments`, { role: 'manager', branch: 'bypass', body: { payroll_regular_item_id: item('emp-a').id, type: 'BONUS', amount: 10, reason: 'x' } });
    assert.equal(r.status, 403);
  });
});
