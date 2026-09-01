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

function fakeSupabaseFor(customerRow) {
  return {
    from(table) {
      const chain = {
        select() { return chain; },
        or() { return Promise.resolve({ data: table === 'customers' && customerRow ? [customerRow] : [], error: null }); },
        eq() { return chain; },
        in() { return chain; },
        order() { return Promise.resolve({ data: [], error: null }); },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      };
      return chain;
    },
  };
}

test('GET /customer360 with no identifier returns 400', async () => {
  const app = buildApp(fakeSupabaseFor(null));
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer360`);
  assert.equal(res.status, 400);
  server.close();
});

test('GET /customer360?customer_id= with a resolvable customer returns customer_found: true', async () => {
  const customerRow = { id: 'c1', name: 'Budi', wa: '6281234567890', phone_e164: '+6281234567890' };
  const supabase = {
    from(table) {
      const chain = {
        select() { return chain; },
        eq(field, value) {
          if (table === 'customers' && field === 'id' && value === 'c1') {
            chain._match = true;
          }
          return chain;
        },
        or() {
          const orResult = Promise.resolve({ data: [], error: null });
          orResult.order = () => Promise.resolve({ data: [], error: null });
          return orResult;
        },
        in() { return chain; },
        order() { return Promise.resolve({ data: [], error: null }); },
        maybeSingle() {
          return Promise.resolve({ data: chain._match ? customerRow : null, error: null });
        },
      };
      return chain;
    },
  };
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer360?customer_id=c1`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.identity.customer_found, true);
  server.close();
});

test('GET /customer360?customer_id= with an unresolvable id returns customer_found: false, still 200', async () => {
  const app = buildApp(fakeSupabaseFor(null));
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer360?customer_id=missing`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.identity.customer_found, false);
  server.close();
});

test('GET /customer360?phone= with an unresolvable phone returns customer_found: false, still 200', async () => {
  const app = buildApp(fakeSupabaseFor(null));
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer360?phone=6281234567890`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.identity.customer_found, false);
  server.close();
});

test('GET /customer360 propagates a db_error as a 200 with resolution db_error, not a 500 crash', async () => {
  const supabase = {
    from() {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        or() { return Promise.resolve({ data: null, error: { message: 'connection lost' } }); },
        in() { return chain; },
        order() { return Promise.resolve({ data: [], error: null }); },
        maybeSingle() { return Promise.resolve({ data: null, error: { message: 'connection lost' } }); },
      };
      return chain;
    },
  };
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer360?customer_id=c1`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.identity.resolution, 'db_error');
  server.close();
});

test('GET /customer360 does not leak fields beyond the established Customer360 contract (identity/customer/membership/loyalty/activity/spending/preferences/data_quality)', async () => {
  const app = buildApp(fakeSupabaseFor(null));
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer360?customer_id=missing`);
  const body = await res.json();
  const allowedKeys = ['version', 'identity', 'customer', 'membership', 'loyalty', 'activity', 'spending', 'preferences', 'data_quality'];
  for (const key of Object.keys(body)) {
    assert.ok(allowedKeys.includes(key), `unexpected top-level field: ${key}`);
  }
  server.close();
});
