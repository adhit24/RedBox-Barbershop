'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createAdminCrmRoutes } = require('../routes/adminCrm');

function buildApp(supabase) {
  const app = express();
  const adminAuth = (req, res, next) => {
    req.adminAuth = { staffId: 'test', role: null, branch: null, sessionVerified: false };
    next();
  };
  app.use('/api/admin/crm', createAdminCrmRoutes(supabase, adminAuth));
  return app;
}

function fakeSupabase({ employees = [] } = {}) {
  return {
    from(table) {
      assert.equal(table, 'employees');
      const chain = {
        _rows: [...employees],
        select() { return chain; },
        order() { return chain; },
        eq(field, value) {
          chain._rows = chain._rows.filter(r => r[field] === value);
          return chain;
        },
        then(resolve) {
          resolve({ data: chain._rows, error: null });
        },
      };
      return chain;
    },
  };
}

test('GET /api/admin/crm/employees returns active employees with business unit counts', async () => {
  const mockEmployees = [
    { id: '1', name: 'Abi Bhakti', business_unit: 'Sundaze', position: 'Barista', branch: 'bypass', is_active: true },
    { id: '2', name: 'Agus Habibi', business_unit: 'Sundaze', position: 'Barista', branch: 'bypass', is_active: true },
    { id: '3', name: 'Adam Apriliano', business_unit: 'Redbox', position: 'Helper Cashier', branch: 'bypass', is_active: true },
    { id: '4', name: 'Aditiya Nugraha', business_unit: 'Redbox', position: 'Helper Cashier', branch: 'sumber', is_active: true },
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
    { id: '1', name: 'Abi Bhakti', business_unit: 'Sundaze', position: 'Barista', branch: 'bypass', is_active: true },
    { id: '2', name: 'Adam Apriliano', business_unit: 'Redbox', position: 'Helper Cashier', branch: 'bypass', is_active: true },
  ];

  const app = buildApp(fakeSupabase({ employees: mockEmployees }));
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/employees?business_unit=Sundaze`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.employees[0].name, 'Abi Bhakti');

  server.close();
});
