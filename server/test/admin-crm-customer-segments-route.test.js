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
        not(field, operator, value) {
          if (operator === 'is' && value === null) {
            chain._rows = chain._rows.filter(r => r[field] !== null && r[field] !== undefined);
          }
          return chain;
        },
        then(resolve) { resolve({ data: chain._rows, error: null }); },
      };
      return chain;
    },
  };
}

test('GET /customer-segments with an empty dataset returns zeroed kpis, not an error', async () => {
  const app = buildApp(fakeSupabase());
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer-segments`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.customers.total, 0);
  server.close();
});

test('GET /customer-segments merges a done booking and a completed transaction for the same phone into one customer', async () => {
  const supabase = fakeSupabase({
    bookings: [{ id: 'bk1', wa: '6281', name: 'Budi', status: 'done', date: '2026-01-01', location: 'csb', barber_id: 'b1', service: 'Haircut' }],
    transactions: [{ id: 'tx1', status: 'completed', customer_id: 'c1', outlet_id: 'o1', schedule_id: 's1', created_at: '2026-08-01T10:00:00.000Z' }],
    transactionItems: [{ transaction_id: 'tx1', service_name: 'Hair Spa' }],
    schedules: [{ id: 's1', barber_id: 'b1' }],
    customers: [{ id: 'c1', wa: '6281', phone_e164: null, name: 'Budi' }],
    outlets: [{ id: 'o1', slug: 'csb', name: 'CSB' }],
    barbers: [{ id: 'b1', name: 'Ubay' }],
  });
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer-segments`);
  const body = await res.json();
  assert.equal(body.customers.total, 1);
  assert.equal(body.customers.items[0].total_visits, 2);
  server.close();
});

test('GET /customer-segments?branch=csb scopes results to that branch only', async () => {
  const supabase = fakeSupabase({
    bookings: [
      { id: 'bk1', wa: '6281', name: 'Budi', status: 'done', date: '2026-01-01', location: 'csb', barber_id: 'b1', service: 'Haircut' },
      { id: 'bk2', wa: '6281', name: 'Budi', status: 'done', date: '2026-02-01', location: 'bypass', barber_id: 'b1', service: 'Haircut' },
    ],
    barbers: [{ id: 'b1', name: 'Ubay' }],
  });
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer-segments?branch=csb`);
  const body = await res.json();
  assert.equal(body.customers.items[0].total_visits, 1);
  server.close();
});

test('GET /customer-segments?limit=&offset= paginates the customer list', async () => {
  const bookings = Array.from({ length: 5 }, (_, i) => ({
    id: `bk${i}`, wa: `628${i}`, name: `Customer ${i}`, status: 'done', date: '2026-08-01', location: 'csb', barber_id: 'b1', service: 'Haircut',
  }));
  const supabase = fakeSupabase({ bookings, barbers: [{ id: 'b1', name: 'Ubay' }] });
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer-segments?limit=2&offset=1`);
  const body = await res.json();
  assert.equal(body.customers.total, 5);
  assert.equal(body.customers.items.length, 2);
  server.close();
});

test('GET /customer-segments clamps an excessive limit instead of erroring', async () => {
  const supabase = fakeSupabase();
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer-segments?limit=99999`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.customers.limit, 200);
  server.close();
});

test('GET /customer-segments excludes transactions with no linked customer_id', async () => {
  const supabase = fakeSupabase({
    transactions: [
      { id: 'tx1', status: 'completed', customer_id: null, outlet_id: 'o1', schedule_id: null, created_at: '2026-08-01T10:00:00.000Z' },
    ],
  });
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer-segments`);
  const body = await res.json();
  assert.equal(body.customers.total, 0);
  server.close();
});
