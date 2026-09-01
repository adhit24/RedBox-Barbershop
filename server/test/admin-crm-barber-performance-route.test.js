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

function fakeSupabase({ bookings = [], transactions = [], transactionItems = [], schedules = [], customers = [], outlets = [], barbers = [] } = {}) {
  const tables = { bookings, transactions, transaction_items: transactionItems, schedules, customers, outlets, barbers };
  return {
    from(table) {
      const rows = tables[table] || [];
      const chain = {
        _rows: rows,
        select() { return chain; },
        eq(field, value) { chain._rows = chain._rows.filter(r => r[field] === value); return chain; },
        in(field, values) { chain._rows = chain._rows.filter(r => values.includes(r[field])); return chain; },
        not(field) { chain._rows = chain._rows.filter(r => r[field] !== null && r[field] !== undefined); return chain; },
        then(resolve) { resolve({ data: chain._rows, error: null }); },
      };
      return chain;
    },
  };
}

test('GET /barber-performance with an empty dataset returns an empty list, not an error', async () => {
  const app = buildApp(fakeSupabase());
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/barber-performance`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.barbers, []);
  server.close();
});

test('GET /barber-performance returns real per-barber customers served and completed services', async () => {
  const supabase = fakeSupabase({
    bookings: [
      { id: 'bk1', wa: '6281', name: 'Budi', status: 'done', date: '2026-01-01', location: 'csb', barber_id: 'b1', service: 'Haircut' },
      { id: 'bk2', wa: '6282', name: 'Sari', status: 'done', date: '2026-01-02', location: 'csb', barber_id: 'b1', service: 'Haircut' },
    ],
    barbers: [{ id: 'b1', name: 'Ubay' }],
  });
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/barber-performance`);
  const body = await res.json();
  const ubay = body.barbers.find(b => b.barber_id === 'b1');
  assert.equal(ubay.customers_served, 2);
  assert.equal(ubay.completed_services, 2);
  server.close();
});

test('GET /barber-performance?branch=csb scopes results to that branch', async () => {
  const supabase = fakeSupabase({
    bookings: [
      { id: 'bk1', wa: '6281', name: 'Budi', status: 'done', date: '2026-01-01', location: 'csb', barber_id: 'b1', service: 'Haircut' },
      { id: 'bk2', wa: '6282', name: 'Sari', status: 'done', date: '2026-02-01', location: 'bypass', barber_id: 'b1', service: 'Haircut' },
    ],
    barbers: [{ id: 'b1', name: 'Ubay' }],
  });
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/barber-performance?branch=csb`);
  const body = await res.json();
  const ubay = body.barbers.find(b => b.barber_id === 'b1');
  assert.equal(ubay.customers_served, 1);
  server.close();
});
