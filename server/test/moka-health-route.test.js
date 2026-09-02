'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const createMokaRouter = require('../moka/routes');

function fakeAdminAuth(adminAuth) {
  return (req, res, next) => {
    req.adminAuth = adminAuth;
    next();
  };
}

function buildApp(supabase, adminAuth) {
  const app = express();
  app.use(express.json());
  app.use('/api', createMokaRouter(supabase, fakeAdminAuth(adminAuth)));
  return app;
}

function fakeSupabase({ outlets = [], moka_tokens = [], transactions = [], schedules = [], sync_logs = [] } = {}) {
  const tables = { outlets, moka_tokens, transactions, schedules, sync_logs };
  return {
    from(table) {
      const rows = tables[table] || [];
      const chain = {
        _rows: rows,
        _order: null,
        _limit: null,
        select() { return chain; },
        eq(field, value) { chain._rows = chain._rows.filter((r) => r[field] === value); return chain; },
        in(field, values) { chain._rows = chain._rows.filter((r) => values.includes(r[field])); return chain; },
        not(field, _op, _val) { chain._rows = chain._rows.filter((r) => r[field] !== null && r[field] !== undefined); return chain; },
        gte(field, value) { chain._rows = chain._rows.filter((r) => r[field] >= value); return chain; },
        lte(field, value) { chain._rows = chain._rows.filter((r) => r[field] <= value); return chain; },
        order(field, { ascending } = {}) {
          chain._rows = [...chain._rows].sort((a, b) => (a[field] > b[field] ? 1 : -1) * (ascending === false ? -1 : 1));
          return chain;
        },
        limit(n) { chain._rows = chain._rows.slice(0, n); return chain; },
        then(resolve) { resolve({ data: chain._rows, error: null }); },
      };
      return chain;
    },
  };
}

const CSB_OUTLET = { id: 'o1', name: 'CSB', slug: 'csb', moka_outlet_id: 'm1', last_polled_at: new Date().toISOString(), is_active: true };
const BYPASS_OUTLET = { id: 'o2', name: 'Bypass', slug: 'bypass', moka_outlet_id: 'm2', last_polled_at: new Date().toISOString(), is_active: true };

test('GET /api/moka/health returns per-outlet health for an owner/unrestricted session', async () => {
  const supabase = fakeSupabase({
    outlets: [CSB_OUTLET, BYPASS_OUTLET],
    moka_tokens: [
      { outlet_id: 'o1', access_token: 'secret-token-1', expires_at: new Date(Date.now() + 3600_000).toISOString() },
      { outlet_id: 'o2', access_token: 'secret-token-2', expires_at: new Date(Date.now() + 3600_000).toISOString() },
    ],
  });
  const app = buildApp(supabase, { staffId: 'owner1', role: 'owner', branch: null, sessionVerified: true });
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/moka/health`, { headers: { 'x-admin-token': 'x' } });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.outlets.length, 2);
  assert.ok(body.outlets.every((o) => o.health === 'healthy'));
  assert.equal(JSON.stringify(body).includes('secret-token'), false);
  server.close();
});

test('GET /api/moka/health scopes a manager session (current Backoffice Supabase-auth role) to only their own outlet', async () => {
  const supabase = fakeSupabase({
    outlets: [CSB_OUTLET, BYPASS_OUTLET],
    moka_tokens: [],
  });
  const app = buildApp(supabase, { staffId: 'manager-csb', role: 'manager', branch: 'csb', sessionVerified: true });
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/moka/health`, { headers: { 'x-admin-token': 'x' } });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.outlets.length, 1);
  assert.equal(body.outlets[0].slug, 'csb');
  server.close();
});

test('GET /api/moka/health cannot be scoped by a query param — branch=bypass is ignored for a manager session locked to csb', async () => {
  const supabase = fakeSupabase({ outlets: [CSB_OUTLET, BYPASS_OUTLET], moka_tokens: [] });
  const app = buildApp(supabase, { staffId: 'manager-csb', role: 'manager', branch: 'csb', sessionVerified: true });
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/moka/health?branch=bypass`, { headers: { 'x-admin-token': 'x' } });
  const body = await res.json();

  assert.equal(body.outlets.length, 1);
  assert.equal(body.outlets[0].slug, 'csb');
  server.close();
});

test('GET /api/moka/health fails closed (403) for a manager with no branch on file — never falls back to unrestricted', async () => {
  const supabase = fakeSupabase({ outlets: [CSB_OUTLET, BYPASS_OUTLET], moka_tokens: [] });
  const app = buildApp(supabase, { staffId: 'manager-nobranch', role: 'manager', branch: null, sessionVerified: true });
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/moka/health`, { headers: { 'x-admin-token': 'x' } });

  assert.equal(res.status, 403);
  server.close();
});

test('GET /api/moka/sync-logs: owner sees the global log; manager gets 403, not an unattributed cross-branch stream', async () => {
  const supabase = fakeSupabase({
    sync_logs: [{ id: 'l1', direction: 'moka_to_web', entity_type: 'order', entity_id: 't1', status: 'success', error_message: null, retry_count: 0, created_at: new Date().toISOString() }],
  });

  const ownerApp = buildApp(supabase, { staffId: 'owner1', role: 'owner', branch: null, sessionVerified: true });
  const ownerServer = ownerApp.listen(0);
  const ownerRes = await fetch(`http://127.0.0.1:${ownerServer.address().port}/api/moka/sync-logs`, { headers: { 'x-admin-token': 'x' } });
  const ownerBody = await ownerRes.json();
  assert.equal(ownerRes.status, 200);
  assert.equal(ownerBody.logs.length, 1);
  ownerServer.close();

  const managerApp = buildApp(supabase, { staffId: 'manager-csb', role: 'manager', branch: 'csb', sessionVerified: true });
  const managerServer = managerApp.listen(0);
  const managerRes = await fetch(`http://127.0.0.1:${managerServer.address().port}/api/moka/sync-logs`, { headers: { 'x-admin-token': 'x' } });
  assert.equal(managerRes.status, 403);
  managerServer.close();
});

test('GET /api/moka/sync-status returns real per-outlet schedule counts', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const supabase = fakeSupabase({
    outlets: [CSB_OUTLET],
    moka_tokens: [{ outlet_id: 'o1', expires_at: new Date(Date.now() + 3600_000).toISOString() }],
    schedules: [{ id: 's1', outlet_id: 'o1', source: 'moka', status: 'completed', start_time: `${today}T09:00:00+07:00` }],
  });
  const app = buildApp(supabase, { staffId: 'owner1', role: 'owner', branch: null, sessionVerified: true });
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/moka/sync-status`, { headers: { 'x-admin-token': 'x' } });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.outlets[0].tokenOk, true);
  assert.equal(body.outlets[0].completedToday, 1);
  server.close();
});
