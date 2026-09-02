'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyOutletHealth,
  resolveMokaOutletScope,
  wibDayBounds,
  getMokaHealth,
  getMokaSyncStatus,
} = require('../moka/health');

function fakeSupabase({ outlets = [], moka_tokens = [], transactions = [], schedules = [] } = {}) {
  const tables = { outlets, moka_tokens, transactions, schedules };
  return {
    from(table) {
      const rows = tables[table] || [];
      const chain = {
        _rows: rows,
        select() { return chain; },
        eq(field, value) { chain._rows = chain._rows.filter((r) => r[field] === value); return chain; },
        in(field, values) { chain._rows = chain._rows.filter((r) => values.includes(r[field])); return chain; },
        gte(field, value) { chain._rows = chain._rows.filter((r) => r[field] >= value); return chain; },
        lte(field, value) { chain._rows = chain._rows.filter((r) => r[field] <= value); return chain; },
        then(resolve) { resolve({ data: chain._rows, error: null }); },
      };
      return chain;
    },
  };
}

test('classifyOutletHealth: missing_token when not connected to Moka at all', () => {
  assert.equal(classifyOutletHealth({ connected: false, hasToken: false, tokenExpired: null, staleMinutes: null }), 'missing_token');
});

test('classifyOutletHealth: missing_token when connected but no token row', () => {
  assert.equal(classifyOutletHealth({ connected: true, hasToken: false, tokenExpired: null, staleMinutes: null }), 'missing_token');
});

test('classifyOutletHealth: expired takes priority over staleness', () => {
  assert.equal(classifyOutletHealth({ connected: true, hasToken: true, tokenExpired: true, staleMinutes: 5 }), 'expired');
});

test('classifyOutletHealth: sync_error when token valid but last successful sync is too stale', () => {
  assert.equal(classifyOutletHealth({ connected: true, hasToken: true, tokenExpired: false, staleMinutes: 121 }), 'sync_error');
});

test('classifyOutletHealth: healthy when token valid and recently synced', () => {
  assert.equal(classifyOutletHealth({ connected: true, hasToken: true, tokenExpired: false, staleMinutes: 5 }), 'healthy');
});

test('classifyOutletHealth: healthy when never synced yet but token is fresh (staleMinutes null is not stale)', () => {
  assert.equal(classifyOutletHealth({ connected: true, hasToken: true, tokenExpired: false, staleMinutes: null }), 'healthy');
});

test('resolveMokaOutletScope: branch_admin is scoped to their own outlet only', () => {
  assert.deepEqual(resolveMokaOutletScope({ role: 'branch_admin', branch: 'csb' }), { slugs: ['csb'] });
});

test('resolveMokaOutletScope: owner sees all outlets', () => {
  assert.deepEqual(resolveMokaOutletScope({ role: 'owner', branch: null }), { slugs: null });
});

test('resolveMokaOutletScope: legacy unrestricted token (role null, sessionVerified false) sees all outlets', () => {
  assert.deepEqual(resolveMokaOutletScope({ role: null, branch: null, sessionVerified: false }), { slugs: null });
});

test('resolveMokaOutletScope: no adminAuth at all defaults to unrestricted (defensive)', () => {
  assert.deepEqual(resolveMokaOutletScope(null), { slugs: null });
  assert.deepEqual(resolveMokaOutletScope(undefined), { slugs: null });
});

test('wibDayBounds: produces a well-formed Asia/Jakarta day window', () => {
  const { dayStr, startIso, endIso } = wibDayBounds(new Date('2026-09-02T20:00:00Z'));
  // 20:00 UTC + 7h = 03:00 the next WIB day
  assert.equal(dayStr, '2026-09-03');
  assert.equal(startIso, '2026-09-03T00:00:00+07:00');
  assert.equal(endIso, '2026-09-03T23:59:59+07:00');
});

test('getMokaHealth: classifies each outlet and never leaks a token value', async () => {
  const supabase = fakeSupabase({
    outlets: [
      { id: 'o1', name: 'CSB', slug: 'csb', moka_outlet_id: 'm1', last_polled_at: new Date().toISOString(), is_active: true },
      { id: 'o2', name: 'Bypass', slug: 'bypass', moka_outlet_id: null, last_polled_at: null, is_active: true },
    ],
    moka_tokens: [{ outlet_id: 'o1', access_token: 'super-secret-value', expires_at: new Date(Date.now() + 3600_000).toISOString() }],
  });

  const result = await getMokaHealth(supabase);

  const csb = result.outlets.find((o) => o.slug === 'csb');
  assert.equal(csb.health, 'healthy');
  assert.equal(csb.connected, true);
  assert.equal(JSON.stringify(csb).includes('super-secret-value'), false);

  const bypass = result.outlets.find((o) => o.slug === 'bypass');
  assert.equal(bypass.health, 'missing_token');
  assert.equal(bypass.connected, false);
});

test('getMokaHealth: counts real transactions today and flags unmatched ones (no schedule_id)', async () => {
  const today = wibDayBounds().startIso.slice(0, 10);
  const supabase = fakeSupabase({
    outlets: [{ id: 'o1', name: 'CSB', slug: 'csb', moka_outlet_id: 'm1', last_polled_at: new Date().toISOString(), is_active: true }],
    moka_tokens: [{ outlet_id: 'o1', expires_at: new Date(Date.now() + 3600_000).toISOString() }],
    transactions: [
      { id: 't1', outlet_id: 'o1', schedule_id: 'sc1', created_at: `${today}T09:00:00+07:00` },
      { id: 't2', outlet_id: 'o1', schedule_id: null, created_at: `${today}T10:00:00+07:00` },
      { id: 't3', outlet_id: 'o1', schedule_id: null, created_at: `${today}T11:00:00+07:00` },
    ],
  });

  const result = await getMokaHealth(supabase);
  const csb = result.outlets.find((o) => o.slug === 'csb');
  assert.equal(csb.transactionsToday, 3);
  assert.equal(csb.unmatchedTransactionsToday, 2);
});

test('getMokaHealth: restricts to the requested outletSlugs', async () => {
  const supabase = fakeSupabase({
    outlets: [
      { id: 'o1', name: 'CSB', slug: 'csb', moka_outlet_id: 'm1', last_polled_at: new Date().toISOString(), is_active: true },
      { id: 'o2', name: 'Bypass', slug: 'bypass', moka_outlet_id: 'm2', last_polled_at: new Date().toISOString(), is_active: true },
    ],
    moka_tokens: [],
  });

  const result = await getMokaHealth(supabase, { outletSlugs: ['csb'] });
  assert.equal(result.outlets.length, 1);
  assert.equal(result.outlets[0].slug, 'csb');
});

test('getMokaSyncStatus: reports token presence and today schedule counts per outlet', async () => {
  const today = wibDayBounds().startIso.slice(0, 10);
  const supabase = fakeSupabase({
    outlets: [{ id: 'o1', name: 'CSB', slug: 'csb', moka_outlet_id: 'm1', last_polled_at: new Date().toISOString(), is_active: true }],
    moka_tokens: [{ outlet_id: 'o1', expires_at: new Date(Date.now() + 3600_000).toISOString(), updated_at: new Date().toISOString() }],
    schedules: [
      { id: 's1', outlet_id: 'o1', source: 'moka', status: 'completed', start_time: `${today}T09:00:00+07:00` },
      { id: 's2', outlet_id: 'o1', source: 'moka', status: 'reserved', start_time: `${today}T14:00:00+07:00` },
      { id: 's3', outlet_id: 'o1', source: 'web', status: 'completed', start_time: `${today}T09:00:00+07:00` },
    ],
  });

  const result = await getMokaSyncStatus(supabase);
  const csb = result.outlets[0];
  assert.equal(csb.completedToday, 1);
  assert.equal(csb.reservedToday, 1);
  assert.equal(csb.tokenOk, true);
  assert.equal(csb.mokaOutletId, 'm1');
});
