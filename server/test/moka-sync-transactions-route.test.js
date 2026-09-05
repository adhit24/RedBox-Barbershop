'use strict';
// POST /api/moka/sync-transactions is a thin trigger over the real order-pull
// engine (pullMokaToWeb in ./sync.js), which itself calls out to Moka's real
// OAuth/REST client — not something a unit test should invoke for real. This
// file stubs ../moka/sync in Node's CommonJS require cache before requiring
// ../moka/routes, so routes.js's `require('./sync')` picks up the stub
// instead of the real module. Node's test runner gives each test FILE its own
// process, so this stub never leaks into other test files.

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');

const syncPath = require.resolve('../moka/sync');
const pullCalls = [];
// routes.js destructures pullMokaToWeb from this module ONCE at require-time,
// so a test can't swap require.cache[syncPath].exports afterwards and expect
// routes.js to see the new function — it already holds a direct reference to
// this one. To make one test fail on demand, this single stub checks a
// mutable flag instead of being replaced.
let failNextPullWith = null;
require.cache[syncPath] = {
  id: syncPath,
  filename: syncPath,
  loaded: true,
  exports: {
    pullMokaToWeb: async (_supabase, outletId) => {
      pullCalls.push(outletId);
      if (failNextPullWith) {
        const message = failNextPullWith;
        failNextPullWith = null;
        throw new Error(message);
      }
      return { processed: 2, skipped: 1, errors: 0 };
    },
    pushScheduleToMoka: async () => ({}),
    pushCheckoutToMoka: async () => ({}),
    handleWebhookEvent: async () => ({}),
    maybeRefreshOutletData: async () => ({}),
    getLastSyncAt: () => null,
  },
};

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

function fakeSupabase({ outlets = [] } = {}) {
  const tables = { outlets };
  return {
    from(table) {
      const rows = tables[table] || [];
      const chain = {
        _rows: rows,
        select() { return chain; },
        eq(field, value) { chain._rows = chain._rows.filter((r) => r[field] === value); return chain; },
        in(field, values) { chain._rows = chain._rows.filter((r) => values.includes(r[field])); return chain; },
        not(field) { chain._rows = chain._rows.filter((r) => r[field] !== null && r[field] !== undefined); return chain; },
        single() { return { then: (resolve) => resolve({ data: chain._rows[0] || null, error: null }) }; },
        then(resolve) { resolve({ data: chain._rows, error: null }); },
      };
      return chain;
    },
  };
}

const CSB = { id: 'o1', name: 'CSB', slug: 'csb', moka_outlet_id: 'm1', is_active: true };
const BYPASS = { id: 'o2', name: 'Bypass', slug: 'bypass', moka_outlet_id: 'm2', is_active: true };

test.beforeEach(() => { pullCalls.length = 0; });

test('POST /api/moka/sync-transactions with no body syncs every outlet an owner session can see', async () => {
  const supabase = fakeSupabase({ outlets: [CSB, BYPASS] });
  const app = buildApp(supabase, { staffId: 'owner1', role: 'owner', branch: null, sessionVerified: true });
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/moka/sync-transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.results.length, 2);
  assert.deepEqual(pullCalls.sort(), ['o1', 'o2']);
  server.close();
});

test('POST /api/moka/sync-transactions with an outlet in body syncs only that one', async () => {
  const supabase = fakeSupabase({ outlets: [CSB, BYPASS] });
  const app = buildApp(supabase, { staffId: 'owner1', role: 'owner', branch: null, sessionVerified: true });
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/moka/sync-transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outlet: 'csb' }),
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(pullCalls, ['o1']);
  assert.equal(body.results[0].processed, 2);
  server.close();
});

test('POST /api/moka/sync-transactions rejects a manager session (current Backoffice Supabase-auth role) targeting a different branch', async () => {
  const supabase = fakeSupabase({ outlets: [CSB, BYPASS] });
  const app = buildApp(supabase, { staffId: 'manager-csb', role: 'manager', branch: 'csb', sessionVerified: true });
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/moka/sync-transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outlet: 'bypass' }),
  });

  assert.equal(res.status, 403);
  assert.deepEqual(pullCalls, []);
  server.close();
});

test('POST /api/moka/sync-transactions with no body for a manager session only syncs their own outlet', async () => {
  const supabase = fakeSupabase({ outlets: [CSB, BYPASS] });
  const app = buildApp(supabase, { staffId: 'manager-csb', role: 'manager', branch: 'csb', sessionVerified: true });
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/moka/sync-transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(pullCalls, ['o1']);
  assert.equal(body.results.length, 1);
  server.close();
});

test('POST /api/moka/sync-transactions fails closed (403) for a manager with no branch on file — never syncs unrestricted', async () => {
  const supabase = fakeSupabase({ outlets: [CSB, BYPASS] });
  const app = buildApp(supabase, { staffId: 'manager-nobranch', role: 'manager', branch: null, sessionVerified: true });
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/moka/sync-transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 403);
  assert.deepEqual(pullCalls, []);
  server.close();
});

test('POST /api/moka/sync-transactions never leaks a raw technical error — logs server-side, returns a safe errorCode', async () => {
  const RAW_ERROR = 'MokaApiError: 401 invalid_token access_token=abc.def.ghi at oauth.js:142';
  failNextPullWith = RAW_ERROR;

  const supabase = fakeSupabase({ outlets: [CSB] });
  const app = buildApp(supabase, { staffId: 'owner1', role: 'owner', branch: null, sessionVerified: true });
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/moka/sync-transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outlet: 'csb' }),
    });
    const bodyText = await res.text();

    assert.equal(res.status, 200);
    assert.equal(bodyText.includes(RAW_ERROR), false);
    assert.equal(bodyText.includes('abc.def.ghi'), false);
    const body = JSON.parse(bodyText);
    assert.equal(body.results[0].status, 'failed');
    assert.equal(body.results[0].errorCode, 'SYNC_FAILED');
  } finally {
    server.close();
  }
});

test('POST /api/moka/sync-transactions returns 404 for an unknown outlet slug', async () => {
  const supabase = fakeSupabase({ outlets: [CSB, BYPASS] });
  const app = buildApp(supabase, { staffId: 'owner1', role: 'owner', branch: null, sessionVerified: true });
  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/moka/sync-transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outlet: 'nonexistent' }),
  });

  assert.equal(res.status, 404);
  server.close();
});
