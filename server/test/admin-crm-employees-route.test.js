'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createAdminCrmRoutes } = require('../routes/adminCrm');

function buildApp(supabase, authOverride) {
  const app = express();
  const adminAuth = (req, res, next) => {
    req.adminAuth = authOverride || { staffId: 'test', role: 'owner', branch: null, sessionVerified: true };
    next();
  };
  app.use('/api/admin/crm', createAdminCrmRoutes(supabase, adminAuth));
  return app;
}

function fakeSupabase({ employees = [], barbers = [] } = {}) {
  return {
    from(table) {
      if (table === 'employees') {
        const chain = {
          _rows: [...employees],
          select() { return chain; },
          order() { return chain; },
          eq(field, value) {
            chain._rows = chain._rows.filter(r => r[field] === value);
            return chain;
          },
          maybeSingle() {
            return Promise.resolve({ data: chain._rows[0] || null, error: null });
          },
          then(resolve) {
            resolve({ data: chain._rows, error: null });
          },
        };
        return chain;
      }
      if (table === 'barbers') {
        const chain = {
          _rows: [...barbers],
          select() { return chain; },
          order() { return chain; },
          eq(field, value) {
            chain._rows = chain._rows.filter(r => r[field] === value);
            return chain;
          },
          maybeSingle() {
            return Promise.resolve({ data: chain._rows[0] || null, error: null });
          },
          then(resolve) {
            resolve({ data: chain._rows, error: null });
          },
        };
        return chain;
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test('GET /api/admin/crm/employees returns active employees with business unit counts', async () => {
  const mockEmployees = [
    { id: '1', name: 'Employee Alpha', business_unit: 'Sundaze', position: 'Barista', branch: 'bypass', is_active: true },
    { id: '2', name: 'Employee Beta', business_unit: 'Sundaze', position: 'Barista', branch: 'bypass', is_active: true },
    { id: '3', name: 'Employee Gamma', business_unit: 'Redbox', position: 'Helper Cashier', branch: 'bypass', is_active: true },
    { id: '4', name: 'Employee Delta', business_unit: 'Redbox', position: 'Helper Cashier', branch: 'sumber', is_active: true },
  ];

  const app = buildApp(fakeSupabase({ employees: mockEmployees }));
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/employees`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.total, 4);
  assert.equal(body.sundaze_count, 2);
  assert.equal(body.redbox_count, 2);
  assert.equal(body.employees.length, 4);

  server.close();
});

test('GET /api/admin/crm/employees filters by business unit', async () => {
  const mockEmployees = [
    { id: '1', name: 'Employee Alpha', business_unit: 'Sundaze', position: 'Barista', branch: 'bypass', is_active: true },
    { id: '2', name: 'Employee Gamma', business_unit: 'Redbox', position: 'Helper Cashier', branch: 'bypass', is_active: true },
  ];

  const app = buildApp(fakeSupabase({ employees: mockEmployees }));
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/employees?business_unit=Sundaze`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.employees[0].name, 'Employee Alpha');

  server.close();
});

test('GET /api/admin/crm/employees/:id returns sanitized employee detail (no base_salary)', async () => {
  const mockEmployees = [
    {
      id: 'e0123456-789a-bcde-f012-3456789abcde',
      employee_code: 'SD-REG-001',
      name: 'Employee Alpha',
      nickname: 'Abi',
      business_unit: 'Sundaze',
      branch: 'bypass',
      branch_name: 'Bypass',
      position: 'Barista',
      employment_type: 'regular',
      payroll_type: 'salary',
      is_active: true,
      join_date: '2025-08-01',
    },
  ];

  const app = buildApp(fakeSupabase({ employees: mockEmployees }));
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/employees/emp-e0123456-789a-bcde-f012-3456789abcde`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.type, 'regular');
  assert.equal(body.person.name, 'Employee Alpha');
  assert.equal(body.person.business_unit, 'Sundaze Cafe');
  assert.equal(body.person.payroll_type, 'Gaji');
  assert.equal(body.person.base_salary, undefined);
  assert.equal(body.person.source, undefined);
  assert.equal(body.person.source_period, undefined);

  server.close();
});

test('GET /api/admin/crm/employees/:id supports barber resolution with Bagi Hasil', async () => {
  const mockBarbers = [
    {
      id: 'csb-barber-alpha',
      name: 'Barber Alpha',
      branch: 'csb',
      is_active: true,
      created_at: '2024-01-01',
    },
  ];

  const app = buildApp(fakeSupabase({ barbers: mockBarbers }));
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/employees/barber-csb-barber-alpha`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.type, 'barber');
  assert.equal(body.person.name, 'Barber Alpha');
  assert.equal(body.person.payroll_type, 'Bagi Hasil');
  assert.equal(body.person.position, 'Kapster');
  assert.equal(body.person.base_salary, undefined);
  assert.equal(body.person.join_date, null); // Proves created_at is NOT mapped to join_date

  server.close();
});

test('GET /api/admin/crm/employees/:id returns generic sanitized error message on failure', async () => {
  const brokenSupabase = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle() {
          return Promise.resolve({ data: null, error: { message: 'relation employees does not exist' } });
        },
      };
    },
  };

  const app = buildApp(brokenSupabase);
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/employees/emp-123`);
  const body = await res.json();

  assert.equal(res.status, 500);
  assert.equal(body.error, 'Failed to load employee data');
  assert.equal(body.error.includes('relation employees'), false);

  server.close();
});

// ── Branch-scope authorization (manager must never see another branch) ────

test('GET /api/admin/crm/employees denies unauthenticated/unverified session', async () => {
  const app = buildApp(fakeSupabase({ employees: [] }), { staffId: 'x', role: null, branch: null, sessionVerified: false });
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/employees`);
  assert.equal(res.status, 403);

  server.close();
});

test('GET /api/admin/crm/employees denies a branch-scoped manager with no branch on profile (fail closed)', async () => {
  const app = buildApp(fakeSupabase({ employees: [] }), { staffId: 'm1', role: 'manager', branch: null, sessionVerified: true });
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/employees`);
  assert.equal(res.status, 403);

  server.close();
});

test('GET /api/admin/crm/employees forces manager scope to their own branch, ignoring the query param', async () => {
  const mockEmployees = [
    { id: '1', name: 'Own Branch Person', business_unit: 'Redbox', position: 'Cashier', branch: 'bypass', is_active: true },
    { id: '2', name: 'Other Branch Person', business_unit: 'Redbox', position: 'Cashier', branch: 'sumber', is_active: true },
  ];
  const app = buildApp(
    fakeSupabase({ employees: mockEmployees }),
    { staffId: 'm1', role: 'manager', branch: 'bypass', sessionVerified: true }
  );
  const server = app.listen(0);
  const port = server.address().port;

  // Manager tries to override scope via query param — must be ignored.
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/employees?branch=sumber`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.employees[0].name, 'Own Branch Person');

  server.close();
});

test('GET /api/admin/crm/employees/:id denies a manager viewing an employee from another branch', async () => {
  const mockEmployees = [
    {
      id: 'e0123456-789a-bcde-f012-3456789abcde',
      employee_code: 'RB-REG-001',
      name: 'Other Branch Person',
      business_unit: 'Redbox',
      branch: 'sumber',
      branch_name: 'Sumber',
      position: 'Cashier',
      employment_type: 'regular',
      payroll_type: 'salary',
      is_active: true,
      join_date: null,
    },
  ];
  const app = buildApp(
    fakeSupabase({ employees: mockEmployees }),
    { staffId: 'm1', role: 'manager', branch: 'bypass', sessionVerified: true }
  );
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/employees/emp-e0123456-789a-bcde-f012-3456789abcde`);
  const body = await res.json();

  assert.equal(res.status, 403);
  assert.equal(body.error, 'branch access denied');

  server.close();
});

test('GET /api/admin/crm/employees/:id denies a manager viewing a barber from another branch', async () => {
  const mockBarbers = [
    { id: 'csb-barber-alpha', name: 'Barber Alpha', branch: 'csb', is_active: true, created_at: '2024-01-01' },
  ];
  const app = buildApp(
    fakeSupabase({ barbers: mockBarbers }),
    { staffId: 'm1', role: 'manager', branch: 'bypass', sessionVerified: true }
  );
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/employees/barber-csb-barber-alpha`);
  const body = await res.json();

  assert.equal(res.status, 403);
  assert.equal(body.error, 'branch access denied');

  server.close();
});

test('GET /api/admin/crm/employees/:id allows a manager viewing an employee within their own branch', async () => {
  const mockEmployees = [
    {
      id: 'e0123456-789a-bcde-f012-3456789abcde',
      employee_code: 'RB-REG-001',
      name: 'Own Branch Person',
      business_unit: 'Redbox',
      branch: 'bypass',
      branch_name: 'Bypass',
      position: 'Cashier',
      employment_type: 'regular',
      payroll_type: 'salary',
      is_active: true,
      join_date: null,
    },
  ];
  const app = buildApp(
    fakeSupabase({ employees: mockEmployees }),
    { staffId: 'm1', role: 'manager', branch: 'bypass', sessionVerified: true }
  );
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/employees/emp-e0123456-789a-bcde-f012-3456789abcde`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.person.name, 'Own Branch Person');

  server.close();
});

