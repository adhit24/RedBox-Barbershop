'use strict';

/**
 * Overtime branch authorization (backend-enforced).
 *   OWNER   -> all branches
 *   MANAGER -> only the branch assigned in the verified session (employee branch, NOT the fingerprint machine)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createRegularPayrollRoutes } = require('../routes/regularPayroll');

function fakeSupabase(store) {
  let seq = 1;
  const table = (name) => {
    const rows = (store[name] = store[name] || []);
    const filters = [];
    const orderBy = [];
    let joinEmployees = false;
    let window = null;
    const run = () => {
      let out = rows.filter((r) => filters.every((f) => f(r)));
      if (orderBy.length) out = [...out].sort((a, b) => orderBy.reduce((acc, c) => acc || String(a[c]).localeCompare(String(b[c])), 0));
      if (window) out = out.slice(window[0], window[1] + 1);
      out = out.slice(0, 1000);
      if (joinEmployees) {
        out = out.map((r) => ({ ...r, employees: (store.employees || []).find((e) => e.id === r.employee_id) || null }));
      }
      return out;
    };
    const api = {
      select(cols) { joinEmployees = name === 'employee_overtime_approvals' && /employees\s*\(/.test(String(cols || '')); return api; },
      eq(c, v) { filters.push((r) => r[c] === v); return api; },
      in(c, v) { filters.push((r) => v.includes(r[c])); return api; },
      gt(c, v) { filters.push((r) => r[c] > v); return api; },
      gte(c, v) { filters.push((r) => r[c] >= v); return api; },
      lte(c, v) { filters.push((r) => r[c] <= v); return api; },
      order(c) { orderBy.push(c); return api; },
      range(a, b) { window = [a, b]; return api; },
      then(res) { res({ data: run(), error: null }); },
      single: async () => { const r = run()[0]; return { data: r || null, error: r ? null : { message: 'not found' } }; },
      maybeSingle: async () => ({ data: run()[0] || null, error: null }),
      insert(v) {
        const arr = [].concat(v).map((r) => ({ id: `n${seq++}`, ...r }));
        rows.push(...arr);
        const o = { select() { return o; }, single: async () => ({ data: arr[0], error: null }), then(res) { res({ data: arr, error: null }); } };
        return o;
      },
      update(u) {
        return {
          eq(c, val) {
            const hit = rows.filter((r) => r[c] === val);
            hit.forEach((r) => Object.assign(r, u));
            const o = { select() { return o; }, single: async () => ({ data: hit[0] || null, error: null }), then(res) { res({ data: hit, error: null }); } };
            return o;
          },
        };
      },
      delete() {
        return { eq(c, val) { const i = rows.findIndex((r) => r[c] === val); if (i >= 0) rows.splice(i, 1); return Promise.resolve({ error: null }); } };
      },
    };
    return api;
  };
  return { from: table };
}

function seed() {
  return {
    employees: [
      { id: 'emp-bypass', name: 'Bypass Barista', business_unit: 'Redbox', branch: 'bypass', position: 'Staff', is_active: true },
      { id: 'emp-csb', name: 'CSB Kasir', business_unit: 'Redbox', branch: 'csb', position: 'Staff', is_active: true },
      // Sundaze staff whose fingerprint machine is Bypass, employee branch bypass
      { id: 'emp-sundaze', name: 'Sundaze Cook', business_unit: 'Sundaze', branch: 'bypass', position: 'Cook', is_active: true },
      // Redbox CSB employee who punches on the BYPASS machine: branch authority stays csb
      { id: 'emp-csb-on-bypass-machine', name: 'CSB Staff On Bypass Machine', business_unit: 'Redbox', branch: 'csb', position: 'Staff', is_active: true },
    ],
    employee_attendance_identity: [
      { id: 'i1', source: 'fingerprint:bypass', external_employee_id: '77', employee_id: 'emp-csb-on-bypass-machine' },
    ],
    employee_attendance: [
      { employee_id: 'emp-bypass', attendance_date: '2026-09-02', overtime_minutes: 60 },
      { employee_id: 'emp-csb', attendance_date: '2026-09-02', overtime_minutes: 60 },
      { employee_id: 'emp-sundaze', attendance_date: '2026-09-02', overtime_minutes: 60 },
      { employee_id: 'emp-csb-on-bypass-machine', attendance_date: '2026-09-02', overtime_minutes: 60 },
    ],
    employee_overtime_approvals: [
      { id: 'ap-bypass', employee_id: 'emp-bypass', attendance_date: '2026-09-02', raw_overtime_minutes: 60, approved_overtime_minutes: 0, status: 'PENDING' },
      { id: 'ap-csb', employee_id: 'emp-csb', attendance_date: '2026-09-02', raw_overtime_minutes: 60, approved_overtime_minutes: 0, status: 'PENDING' },
      { id: 'ap-sundaze', employee_id: 'emp-sundaze', attendance_date: '2026-09-02', raw_overtime_minutes: 60, approved_overtime_minutes: 0, status: 'PENDING' },
      { id: 'ap-csb-machine', employee_id: 'emp-csb-on-bypass-machine', attendance_date: '2026-09-02', raw_overtime_minutes: 60, approved_overtime_minutes: 0, status: 'PENDING' },
    ],
    payroll_runs: [],
    payroll_regular_items: [],
    payroll_adjustments: [],
  };
}

async function withServer(store, fn) {
  const supabase = fakeSupabase(store);
  // Test auth: identity comes from headers (production uses the verified Supabase session)
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
  try { await fn(call); } finally { await new Promise((r) => server.close(r)); }
}

const ids = (json) => json.approvals.map((a) => a.id).sort();

test('List scope: manager Bypass sees Bypass + Sundaze(bypass) approvals, never CSB (incl. CSB staff on the Bypass machine)', async () => {
  await withServer(seed(), async (call) => {
    const r = await call('GET', '/overtime/approvals', { role: 'manager', branch: 'bypass' });
    assert.equal(r.status, 200);
    assert.deepEqual(ids(r.json), ['ap-bypass', 'ap-sundaze']);
  });
});

test('List scope: manager CSB sees only CSB-branch employees (machine location is irrelevant)', async () => {
  await withServer(seed(), async (call) => {
    const r = await call('GET', '/overtime/approvals', { role: 'manager', branch: 'CSB' }); // case-insensitive
    assert.equal(r.status, 200);
    assert.deepEqual(ids(r.json), ['ap-csb', 'ap-csb-machine']);
  });
});

test('List scope: owner sees every branch', async () => {
  await withServer(seed(), async (call) => {
    const r = await call('GET', '/overtime/approvals', { role: 'owner' });
    assert.equal(r.status, 200);
    assert.equal(ids(r.json).length, 4);
  });
});

test('Approve / reject scope: manager Bypass can review Bypass but gets 403 (and no mutation) for CSB', async () => {
  const store = seed();
  await withServer(store, async (call) => {
    const ok = await call('POST', '/overtime/approvals/ap-bypass/review', { role: 'manager', branch: 'bypass', body: { status: 'APPROVED', approved_minutes: 60 } });
    assert.equal(ok.status, 200);
    assert.equal(store.employee_overtime_approvals.find((a) => a.id === 'ap-bypass').status, 'APPROVED');

    const sundaze = await call('POST', '/overtime/approvals/ap-sundaze/review', { role: 'manager', branch: 'bypass', body: { status: 'REJECTED' } });
    assert.equal(sundaze.status, 200, 'Sundaze staff of the Bypass branch is in scope');

    const approveCsb = await call('POST', '/overtime/approvals/ap-csb/review', { role: 'manager', branch: 'bypass', body: { status: 'APPROVED', approved_minutes: 60 } });
    assert.equal(approveCsb.status, 403);
    const rejectCsb = await call('POST', '/overtime/approvals/ap-csb/review', { role: 'manager', branch: 'bypass', body: { status: 'REJECTED' } });
    assert.equal(rejectCsb.status, 403);
    const csbOnBypassMachine = await call('POST', '/overtime/approvals/ap-csb-machine/review', { role: 'manager', branch: 'bypass', body: { status: 'APPROVED', approved_minutes: 60 } });
    assert.equal(csbOnBypassMachine.status, 403, 'fingerprint machine != authorization branch');

    for (const id of ['ap-csb', 'ap-csb-machine']) {
      const row = store.employee_overtime_approvals.find((a) => a.id === id);
      assert.equal(row.status, 'PENDING');
      assert.equal(row.approved_overtime_minutes, 0);
    }
  });
});

test('Approve scope: manager CSB cannot review Bypass; owner can review both', async () => {
  const store = seed();
  await withServer(store, async (call) => {
    const denied = await call('POST', '/overtime/approvals/ap-bypass/review', { role: 'manager', branch: 'csb', body: { status: 'REJECTED' } });
    assert.equal(denied.status, 403);
    assert.equal(store.employee_overtime_approvals.find((a) => a.id === 'ap-bypass').status, 'PENDING');

    const ownerBypass = await call('POST', '/overtime/approvals/ap-bypass/review', { role: 'owner', body: { status: 'APPROVED', approved_minutes: 60 } });
    const ownerCsb = await call('POST', '/overtime/approvals/ap-csb/review', { role: 'owner', body: { status: 'APPROVED', approved_minutes: 60 } });
    assert.equal(ownerBypass.status, 200);
    assert.equal(ownerCsb.status, 200);
  });
});

test('Sync scope: manager Bypass only syncs Bypass-branch employees; owner syncs all', async () => {
  const store = seed();
  store.employee_overtime_approvals = []; // nothing synced yet
  await withServer(store, async (call) => {
    const m = await call('POST', '/overtime/sync', { role: 'manager', branch: 'bypass', body: { period_start: '2026-08-26', period_end: '2026-09-25' } });
    assert.equal(m.status, 200);
    assert.deepEqual(store.employee_overtime_approvals.map((a) => a.employee_id).sort(), ['emp-bypass', 'emp-sundaze']);

    const o = await call('POST', '/overtime/sync', { role: 'owner', body: { period_start: '2026-08-26', period_end: '2026-09-25' } });
    assert.equal(o.status, 200);
    assert.equal(store.employee_overtime_approvals.length, 4);
  });
});

test('Fail closed: a manager / branch admin without an assigned branch gets 403 on every overtime route; unknown role is refused', async () => {
  await withServer(seed(), async (call) => {
    assert.equal((await call('GET', '/overtime/approvals', { role: 'manager' })).status, 403);
    assert.equal((await call('POST', '/overtime/approvals/ap-bypass/review', { role: 'manager', body: { status: 'REJECTED' } })).status, 403);
    assert.equal((await call('POST', '/overtime/sync', { role: 'manager', body: {} })).status, 403);
    assert.equal((await call('GET', '/overtime/approvals', { role: 'branch_admin' })).status, 403);
    assert.equal((await call('POST', '/overtime/sync', { role: 'branch_admin', branch: 'bypass', body: {} })).status, 403, 'branch_admin cannot mutate overtime');
    assert.equal((await call('POST', '/overtime/approvals/ap-bypass/review', { role: 'cashier', branch: 'bypass', body: { status: 'REJECTED' } })).status, 403);
  });
});

test('branch_admin may read only their own branch', async () => {
  await withServer(seed(), async (call) => {
    const r = await call('GET', '/overtime/approvals', { role: 'branch_admin', branch: 'csb' });
    assert.equal(r.status, 200);
    assert.deepEqual(ids(r.json), ['ap-csb', 'ap-csb-machine']);
  });
});
