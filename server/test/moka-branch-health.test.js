'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const {
  deriveBranchHealth,
  getBranchHealthOverview,
  DELAY_THRESHOLD_MS,
} = require('../services/mokaBranchHealth');
const createMokaRouter = require('../moka/routes');

test('deriveBranchHealth: returns HEALTHY for active token and recent successful sync', () => {
  const now = new Date('2026-09-09T10:00:00Z');
  const outlet = { id: 'out-1', name: 'CSB Mall', slug: 'csb', moka_outlet_id: '1001' };
  const token = { expires_at: '2026-12-31T23:59:59Z', updated_at: '2026-06-01T00:00:00Z' };
  const syncState = {
    last_status: 'SUCCESS',
    last_successful_sync_at: '2026-09-09T09:30:00Z',
    last_started_at: '2026-09-09T09:29:00Z',
    last_error: null,
    last_run_stats: { fetched: 10, unmapped: 0, anomalies: 0, processed: 1, qty_deducted: 1, skipped_duplicate: 0 },
  };

  const result = deriveBranchHealth(outlet, token, syncState, now);
  assert.equal(result.healthState, 'HEALTHY');
  assert.equal(result.attentionReason, null);
  assert.equal(result.hasToken, true);
  assert.equal(result.tokenExpired, false);
  assert.equal(result.lastStatus, 'SUCCESS');
});

test('deriveBranchHealth: returns PARTIAL when unmapped items or anomalies exist', () => {
  const now = new Date('2026-09-09T10:00:00Z');
  const outlet = { id: 'out-1', name: 'CSB Mall', slug: 'csb', moka_outlet_id: '1001' };
  const token = { expires_at: '2026-12-31T23:59:59Z', updated_at: '2026-06-01T00:00:00Z' };
  const syncState = {
    last_status: 'PARTIAL',
    last_successful_sync_at: '2026-09-09T09:30:00Z',
    last_started_at: '2026-09-09T09:29:00Z',
    last_error: null,
    last_run_stats: { fetched: 10, unmapped: 3, anomalies: 3, processed: 0, qty_deducted: 0, skipped_duplicate: 0 },
  };

  const result = deriveBranchHealth(outlet, token, syncState, now);
  assert.equal(result.healthState, 'PARTIAL');
  assert.match(result.attentionReason, /3 item belum terpetakan/);
});

test('deriveBranchHealth: returns DELAYED when last successful sync exceeds 2 hours', () => {
  const now = new Date('2026-09-09T10:00:00Z');
  const outlet = { id: 'out-1', name: 'CSB Mall', slug: 'csb', moka_outlet_id: '1001' };
  const token = { expires_at: '2026-12-31T23:59:59Z', updated_at: '2026-06-01T00:00:00Z' };
  const syncState = {
    last_status: 'SUCCESS',
    last_successful_sync_at: '2026-09-09T07:00:00Z', // 3 hours ago (> 2h threshold)
    last_started_at: '2026-09-09T07:00:00Z',
    last_error: null,
    last_run_stats: { fetched: 10, unmapped: 0, anomalies: 0, processed: 0, qty_deducted: 0, skipped_duplicate: 0 },
  };

  const result = deriveBranchHealth(outlet, token, syncState, now);
  assert.equal(result.healthState, 'DELAYED');
  assert.match(result.attentionReason, /lebih dari 2 jam lalu/);
});

test('deriveBranchHealth: returns TOKEN_EXPIRED when token expiry is in the past', () => {
  const now = new Date('2026-09-09T10:00:00Z');
  const outlet = { id: 'out-1', name: 'CSB Mall', slug: 'csb', moka_outlet_id: '1001' };
  const token = { expires_at: '2026-09-08T00:00:00Z', updated_at: '2026-06-01T00:00:00Z' };
  const syncState = {
    last_status: 'SUCCESS',
    last_successful_sync_at: '2026-09-09T09:30:00Z',
    last_started_at: '2026-09-09T09:29:00Z',
    last_error: null,
  };

  const result = deriveBranchHealth(outlet, token, syncState, now);
  assert.equal(result.healthState, 'TOKEN_EXPIRED');
  assert.equal(result.tokenExpired, true);
  assert.match(result.attentionReason, /Token Moka telah kedaluwarsa/);
});

test('deriveBranchHealth: returns NOT_CONFIGURED when token or moka_outlet_id is missing', () => {
  const now = new Date('2026-09-09T10:00:00Z');
  const outletNoMoka = { id: 'out-1', name: 'Parker', slug: 'parker', moka_outlet_id: null };
  const token = { expires_at: '2027-01-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z' };

  const res1 = deriveBranchHealth(outletNoMoka, token, null, now);
  assert.equal(res1.healthState, 'NOT_CONFIGURED');
  assert.match(res1.attentionReason, /outlet ID belum dikonfigurasi/);

  const outletWithMoka = { id: 'out-2', name: 'CSB', slug: 'csb', moka_outlet_id: '1001' };
  const res2 = deriveBranchHealth(outletWithMoka, null, null, now);
  assert.equal(res2.healthState, 'NOT_CONFIGURED');
  assert.match(res2.attentionReason, /Token Moka belum tersedia/);
});

test('deriveBranchHealth: returns ERROR when last sync status is FAILED or last_error exists', () => {
  const now = new Date('2026-09-09T10:00:00Z');
  const outlet = { id: 'out-1', name: 'CSB Mall', slug: 'csb', moka_outlet_id: '1001' };
  const token = { expires_at: '2027-01-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z' };
  const syncState = {
    last_status: 'FAILED',
    last_successful_sync_at: '2026-09-09T09:00:00Z',
    last_started_at: '2026-09-09T09:59:00Z',
    last_error: 'Moka 502 Bad Gateway',
  };

  const result = deriveBranchHealth(outlet, token, syncState, now);
  assert.equal(result.healthState, 'ERROR');
  assert.equal(result.attentionReason, 'Moka 502 Bad Gateway');
});

// Helper for Supabase mock
function createFakeSupabase({ outlets = [], tokens = [], syncStates = [] }) {
  return {
    from(table) {
      if (table === 'outlets') {
        return {
          select: () => ({
            eq: () => ({
              eq: (col, val) => Promise.resolve({ data: outlets.filter((o) => o[col] === val), error: null }),
              then: (resolve) => resolve({ data: outlets, error: null }),
            }),
          }),
        };
      }
      if (table === 'moka_tokens') {
        return {
          select: (fields) => {
            // Verify no secret access token is queried
            assert.ok(!fields.includes('access_token'));
            assert.ok(!fields.includes('refresh_token'));
            return Promise.resolve({ data: tokens, error: null });
          },
        };
      }
      if (table === 'moka_stockist_sync_state') {
        return {
          select: () => Promise.resolve({ data: syncStates, error: null }),
        };
      }
      return {
        select: () => Promise.resolve({ data: [], error: null }),
      };
    },
  };
}

test('getBranchHealthOverview: owner sees all branches and no secrets are leaked', async () => {
  const outlets = [
    { id: 'o-csb', name: 'CSB', slug: 'csb', moka_outlet_id: '101', is_active: true },
    { id: 'o-byp', name: 'Bypass', slug: 'bypass', moka_outlet_id: '102', is_active: true },
  ];
  const tokens = [
    { outlet_id: 'o-csb', expires_at: '2027-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    { outlet_id: 'o-byp', expires_at: '2027-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  ];
  const syncStates = [
    { outlet_id: 'o-csb', last_status: 'SUCCESS', last_successful_sync_at: new Date().toISOString() },
    { outlet_id: 'o-byp', last_status: 'SUCCESS', last_successful_sync_at: new Date().toISOString() },
  ];

  const supabase = createFakeSupabase({ outlets, tokens, syncStates });
  const auth = { staffId: 'owner-1', role: 'owner', branch: null, sessionVerified: true };

  const result = await getBranchHealthOverview({ supabase, auth });
  assert.equal(result.branches.length, 2);
  assert.equal(result.branches[0].slug, 'csb');
  assert.equal(result.branches[1].slug, 'bypass');

  // Verify no sensitive token fields leaked
  for (const b of result.branches) {
    assert.equal(b.accessToken, undefined);
    assert.equal(b.refreshToken, undefined);
    assert.equal(b.access_token, undefined);
    assert.equal(b.refresh_token, undefined);
  }
});

test('getBranchHealthOverview: manager sees only their assigned branch', async () => {
  const outlets = [
    { id: 'o-csb', name: 'CSB', slug: 'csb', moka_outlet_id: '101', is_active: true },
    { id: 'o-byp', name: 'Bypass', slug: 'bypass', moka_outlet_id: '102', is_active: true },
  ];
  const tokens = [
    { outlet_id: 'o-csb', expires_at: '2027-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  ];
  const syncStates = [
    { outlet_id: 'o-csb', last_status: 'SUCCESS', last_successful_sync_at: new Date().toISOString() },
  ];

  const supabase = createFakeSupabase({ outlets, tokens, syncStates });
  const auth = { staffId: 'mgr-1', role: 'manager', branch: 'csb', sessionVerified: true };

  const result = await getBranchHealthOverview({ supabase, auth });
  assert.equal(result.branches.length, 1);
  assert.equal(result.branches[0].slug, 'csb');
});

test('getBranchHealthOverview: manager without branch fails closed (403)', async () => {
  const supabase = createFakeSupabase({});
  const auth = { staffId: 'mgr-no-branch', role: 'manager', branch: null, sessionVerified: true };

  await assert.rejects(
    async () => getBranchHealthOverview({ supabase, auth }),
    (err) => err.status === 403 && /Manager has no assigned branch/.test(err.message)
  );
});

test('getBranchHealthOverview: unauthenticated or invalid role fails closed', async () => {
  const supabase = createFakeSupabase({});
  await assert.rejects(
    async () => getBranchHealthOverview({ supabase, auth: null }),
    (err) => err.status === 401
  );

  await assert.rejects(
    async () => getBranchHealthOverview({ supabase, auth: { role: 'barber', sessionVerified: true } }),
    (err) => err.status === 403
  );
});

test('router integration: GET /api/moka/branch-health works and no manual sync routes exist', async () => {
  const outlets = [{ id: 'o-csb', name: 'CSB', slug: 'csb', moka_outlet_id: '101', is_active: true }];
  const tokens = [{ outlet_id: 'o-csb', expires_at: '2027-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }];
  const syncStates = [{ outlet_id: 'o-csb', last_status: 'SUCCESS', last_successful_sync_at: new Date().toISOString() }];
  const supabase = createFakeSupabase({ outlets, tokens, syncStates });

  const fakeAdminAuth = (req, _res, next) => {
    req.adminAuth = { staffId: 'owner-1', role: 'owner', branch: null, sessionVerified: true };
    next();
  };

  const app = express();
  app.use(express.json());
  app.use('/api', createMokaRouter(supabase, fakeAdminAuth));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${baseUrl}/api/moka/branch-health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.branches));
    assert.equal(body.branches.length, 1);
    assert.equal(body.branches[0].slug, 'csb');
    assert.equal(body.branches[0].healthState, 'HEALTHY');

    // Confirm no manual sync trigger route exists
    const noManualSyncRes = await fetch(`${baseUrl}/api/moka/sync-transactions`, { method: 'POST' });
    assert.equal(noManualSyncRes.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
