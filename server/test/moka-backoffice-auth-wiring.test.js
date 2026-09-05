'use strict';
// Proves server/index.js's actual wiring — createMokaRouter(supabase,
// createBackofficeSupabaseAuth(supabase, adminAuth)) — not just that
// resolveMokaOutletScope's logic is correct in isolation (see
// moka-health-route.test.js / moka-sync-transactions-route.test.js for that).
// This file builds the router with the REAL createBackofficeSupabaseAuth
// middleware, so a request has to pass real Supabase-session verification to
// reach the route at all — exactly the path Backoffice uses since PR #68
// (apiClient.ts sends `Authorization: Bearer <Supabase access token>`).

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createBackofficeSupabaseAuth } = require('../middleware/backofficeSupabaseAuth');
const createMokaRouter = require('../moka/routes');

const BACKOFFICE_HOST = 'backoffice.redboxbarbershop.com';

function legacyAdminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || '';
  if (token !== 'legacy-secret') return res.status(401).json({ error: 'Unauthorized' });
  req.adminAuth = { staffId: 'cron-service', role: null, branch: null, sessionVerified: false };
  next();
}

function fakeSupabase({ user, userError = null, profile, profileError = null, outlets = [], moka_tokens = [] } = {}) {
  const tables = { outlets, moka_tokens };
  return {
    auth: {
      getUser: async () => ({ data: { user }, error: userError }),
    },
    from(table) {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: profile ?? null, error: profileError }),
            }),
          }),
        };
      }
      const rows = tables[table] || [];
      const chain = {
        _rows: rows,
        select() { return chain; },
        eq(field, value) { chain._rows = chain._rows.filter((r) => r[field] === value); return chain; },
        in(field, values) { chain._rows = chain._rows.filter((r) => values.includes(r[field])); return chain; },
        not(field) { chain._rows = chain._rows.filter((r) => r[field] !== null && r[field] !== undefined); return chain; },
        gte(field, value) { chain._rows = chain._rows.filter((r) => r[field] >= value); return chain; },
        lte(field, value) { chain._rows = chain._rows.filter((r) => r[field] <= value); return chain; },
        then(resolve) { resolve({ data: chain._rows, error: null }); },
      };
      return chain;
    },
  };
}

// req.hostname is a getter on Express's request object (computed from the
// Host/X-Forwarded-Host header) — it can't be assigned directly. `trust
// proxy` + a real X-Forwarded-Host header on each request is how this suite
// genuinely exercises createBackofficeSupabaseAuth's host check end-to-end.
const BACKOFFICE_HEADERS = { 'x-forwarded-host': BACKOFFICE_HOST };

function buildApp(supabase) {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  const backofficeAuth = createBackofficeSupabaseAuth(supabase, legacyAdminAuth);
  app.use('/api', createMokaRouter(supabase, backofficeAuth));
  return app;
}

const CSB_OUTLET = { id: 'o1', name: 'CSB', slug: 'csb', moka_outlet_id: 'm1', last_polled_at: new Date().toISOString(), is_active: true };
const BYPASS_OUTLET = { id: 'o2', name: 'Bypass', slug: 'bypass', moka_outlet_id: 'm2', last_polled_at: new Date().toISOString(), is_active: true };

test('1. a real Supabase Owner bearer session can GET /api/moka/health and sees every outlet', async () => {
  const supabase = fakeSupabase({
    user: { id: 'owner-1', email: 'suwandi_gunawan@yahoo.com' },
    profile: { id: 'owner-1', name: 'Owner', role: 'owner', branch: null },
    outlets: [CSB_OUTLET, BYPASS_OUTLET],
  });
  const server = buildApp(supabase).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/moka/health`, {
      headers: { authorization: 'Bearer real-owner-session', ...BACKOFFICE_HEADERS },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.outlets.length, 2);
  } finally {
    server.close();
  }
});

test('2. a real Supabase Manager bearer session can GET health only for their assigned branch', async () => {
  const supabase = fakeSupabase({
    user: { id: 'mgr-1', email: 'manager.csb@redbox.test' },
    profile: { id: 'mgr-1', name: 'Manager CSB', role: 'manager', branch: 'csb' },
    outlets: [CSB_OUTLET, BYPASS_OUTLET],
  });
  const server = buildApp(supabase).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/moka/health`, {
      headers: { authorization: 'Bearer real-manager-session', ...BACKOFFICE_HEADERS },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.outlets.length, 1);
    assert.equal(body.outlets[0].slug, 'csb');
  } finally {
    server.close();
  }
});

test('3. a real Supabase Manager bearer session cannot target another outlet in POST /sync-transactions', async () => {
  const supabase = fakeSupabase({
    user: { id: 'mgr-1', email: 'manager.csb@redbox.test' },
    profile: { id: 'mgr-1', name: 'Manager CSB', role: 'manager', branch: 'csb' },
    outlets: [CSB_OUTLET, BYPASS_OUTLET],
  });
  const server = buildApp(supabase).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/moka/sync-transactions`, {
      method: 'POST',
      headers: { authorization: 'Bearer real-manager-session', 'Content-Type': 'application/json', ...BACKOFFICE_HEADERS },
      body: JSON.stringify({ outlet: 'bypass' }),
    });
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('4. a real Supabase Manager bearer session with no branch on file fails closed (403), never unrestricted', async () => {
  const supabase = fakeSupabase({
    user: { id: 'mgr-2', email: 'manager.nobranch@redbox.test' },
    profile: { id: 'mgr-2', name: 'Manager (unassigned)', role: 'manager', branch: null },
    outlets: [CSB_OUTLET, BYPASS_OUTLET],
  });
  const server = buildApp(supabase).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/moka/health`, {
      headers: { authorization: 'Bearer real-manager-session', ...BACKOFFICE_HEADERS },
    });
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('5. an invalid/expired Supabase bearer returns 401, never reaches the route', async () => {
  const supabase = fakeSupabase({
    user: null,
    userError: { message: 'invalid JWT' },
    outlets: [CSB_OUTLET],
  });
  const server = buildApp(supabase).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/moka/health`, {
      headers: { authorization: 'Bearer expired-or-garbage-token', ...BACKOFFICE_HEADERS },
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('6. legacy admin auth still works unchanged for a non-Backoffice-host caller (cron/ops)', async () => {
  const supabase = fakeSupabase({ outlets: [CSB_OUTLET, BYPASS_OUTLET] });
  const app = express();
  app.use(express.json());
  // No Backoffice-host middleware here — simulates a request that never
  // arrives via the backoffice.redboxbarbershop.com host at all.
  const backofficeAuth = createBackofficeSupabaseAuth(supabase, legacyAdminAuth);
  app.use('/api', createMokaRouter(supabase, backofficeAuth));
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/moka/health`, {
      headers: { 'x-admin-token': 'legacy-secret' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    // Legacy/system callers are unrestricted, unchanged from before this PR.
    assert.equal(body.outlets.length, 2);
  } finally {
    server.close();
  }
});

test('7. owner can sync all outlets via POST /sync-transactions with no body', async () => {
  const syncPath = require.resolve('../moka/sync');
  const pullCalls = [];
  require.cache[syncPath] = {
    id: syncPath,
    filename: syncPath,
    loaded: true,
    exports: {
      pullMokaToWeb: async (_supabase, outletId) => { pullCalls.push(outletId); return { processed: 1, skipped: 0, errors: 0 }; },
      pushScheduleToMoka: async () => ({}),
      pushCheckoutToMoka: async () => ({}),
      handleWebhookEvent: async () => ({}),
      maybeRefreshOutletData: async () => ({}),
      getLastSyncAt: () => null,
    },
  };
  // Re-require routes.js so it picks up this test's own sync stub, since an
  // earlier test file in the same run could have left a different one.
  delete require.cache[require.resolve('../moka/routes')];
  const freshCreateMokaRouter = require('../moka/routes');

  const supabase = fakeSupabase({
    user: { id: 'owner-1', email: 'suwandi_gunawan@yahoo.com' },
    profile: { id: 'owner-1', name: 'Owner', role: 'owner', branch: null },
    outlets: [CSB_OUTLET, BYPASS_OUTLET],
  });
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  const backofficeAuth = createBackofficeSupabaseAuth(supabase, legacyAdminAuth);
  app.use('/api', freshCreateMokaRouter(supabase, backofficeAuth));
  const server = app.listen(0);

  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/moka/sync-transactions`, {
      method: 'POST',
      headers: { authorization: 'Bearer real-owner-session', 'Content-Type': 'application/json', ...BACKOFFICE_HEADERS },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(pullCalls.sort(), ['o1', 'o2']);
    assert.equal(body.results.length, 2);
  } finally {
    server.close();
  }
});

test('8. a manager cannot read the unattributed global sync log', async () => {
  const supabase = fakeSupabase({
    user: { id: 'mgr-1', email: 'manager.csb@redbox.test' },
    profile: { id: 'mgr-1', name: 'Manager CSB', role: 'manager', branch: 'csb' },
    outlets: [CSB_OUTLET],
  });
  const server = buildApp(supabase).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/moka/sync-logs`, {
      headers: { authorization: 'Bearer real-manager-session', ...BACKOFFICE_HEADERS },
    });
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('10. no token field ever appears in the /api/moka/health response body', async () => {
  const supabase = fakeSupabase({
    user: { id: 'owner-1', email: 'suwandi_gunawan@yahoo.com' },
    profile: { id: 'owner-1', name: 'Owner', role: 'owner', branch: null },
    outlets: [CSB_OUTLET],
    moka_tokens: [{ outlet_id: 'o1', access_token: 'super-secret-access-token', refresh_token: 'super-secret-refresh-token', expires_at: new Date(Date.now() + 3600_000).toISOString() }],
  });
  const server = buildApp(supabase).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/moka/health`, {
      headers: { authorization: 'Bearer real-owner-session', ...BACKOFFICE_HEADERS },
    });
    const bodyText = await res.text();
    assert.equal(res.status, 200);
    assert.equal(bodyText.includes('super-secret'), false);
  } finally {
    server.close();
  }
});
