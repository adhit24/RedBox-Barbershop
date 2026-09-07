'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const MokaClient = require('../moka/client');
const { syncCurrentMonthTx } = require('../moka/txSync');

// ── Minimal in-memory Supabase mock — same shape as
// server/test/stockist-moka-sync.test.js's, extended with .or()/.in() as
// no-ops (this suite doesn't need them to actually filter) since txSync's
// mapping lookup uses `.or(...)`.
function createMockSupabase({ seed = {}, rpc } = {}) {
  const store = {};
  for (const [table, rows] of Object.entries(seed)) store[table] = rows.map((r) => ({ ...r }));
  const table = (name) => (store[name] ||= []);
  const uid = () => `id-${Math.random().toString(36).slice(2, 10)}`;

  function builder(name) {
    let mode = 'select';
    let payload = null;
    let upsertOpts = null;
    const filters = [];

    function rows() {
      return table(name).filter((row) => filters.every(([key, value]) => row[key] === value));
    }

    const api = {
      select() { return api; },
      insert(obj) { mode = 'insert'; payload = obj; return api; },
      update(obj) { mode = 'update'; payload = obj; return api; },
      upsert(obj, opts) { mode = 'upsert'; payload = obj; upsertOpts = opts; return api; },
      eq(key, value) { filters.push([key, value]); return api; },
      is(key, value) { filters.push([key, value]); return api; },
      in() { return api; },
      or() { return api; },
      not() { return api; },
      limit() { return api; },
      order() { return api; },
      async maybeSingle() { return this._exec(true); },
      async single() { return this._exec(true); },
      async then(resolve) { resolve(await this._exec(false)); },
      async _exec(single) {
        if (mode === 'insert') {
          const created = { id: uid(), ...payload };
          table(name).push(created);
          return { data: single ? created : [created], error: null };
        }
        if (mode === 'update') {
          const matched = rows();
          matched.forEach((row) => Object.assign(row, payload));
          return { data: single ? matched[0] || null : matched, error: null };
        }
        if (mode === 'upsert') {
          const keys = (upsertOpts?.onConflict || '').split(',').filter(Boolean);
          const rowsToUpsert = Array.isArray(payload) ? payload : [payload];
          const results = rowsToUpsert.map((p) => {
            const existing = keys.length ? table(name).find((row) => keys.every((k) => row[k] === p[k])) : null;
            if (existing) return Object.assign(existing, p);
            const created = { id: uid(), ...p };
            table(name).push(created);
            return created;
          });
          return { data: single ? results[0] : results, error: null };
        }
        const matched = rows();
        return { data: single ? (matched[0] ?? null) : matched, error: null };
      },
    };
    return api;
  }

  return {
    _store: store,
    from: (name) => builder(name),
    rpc: rpc || (async () => ({ data: { quantity_before: 100, quantity_after: 99 }, error: null })),
  };
}

const OUTLET = { id: 'out-csb', slug: 'csb', moka_outlet_id: '216102' };

function withPatchedFetch(fn, impl) {
  const original = MokaClient.prototype.getPaidTransactionsPage;
  MokaClient.prototype.getPaidTransactionsPage = impl;
  return fn().finally(() => { MokaClient.prototype.getPaidTransactionsPage = original; });
}

function baseSeed() {
  return {
    users: [{ id: 'owner-1', role: 'owner' }],
    inventory_locations: [{ id: 'loc-csb', outlet_id: OUTLET.id }],
    moka_item_mappings: [{ moka_item_id: 'm-1', moka_variant_id: null, product_id: 'p-1', outlet_id: OUTLET.id, is_active: true, classification: 'STOCK_PRODUCT' }],
  };
}

// ── Test A — valid transaction page ─────────────────────────────────────
test('Test A: a valid page with a real transaction is fetched, normalized, and processed', async () => {
  const supabase = createMockSupabase({ seed: baseSeed() });
  await withPatchedFetch(
    () => syncCurrentMonthTx(supabase, OUTLET, {}),
    async ({ sinceEpoch }) => ({
      data: {
        payments: [{
          id: 'tx-a1', receipt_number: 'RB-A1', transaction_time: '2026-09-06T10:00:00Z',
          net_sales: 50000, gross_sales: 50000, total_collected: 50000,
          checkouts: [{ item_id: 'm-1', quantity: 2 }],
        }],
        completed: true,
      },
    }),
  );
  assert.equal(supabase._store.moka_stockist_sales.length, 1);
  assert.equal(supabase._store.moka_stockist_sales[0].processing_status, 'PROCESSED');
  assert.equal(supabase._store.moka_transactions.length, 1);
});

// ── Test B — valid empty page ────────────────────────────────────────────
test('Test B: a documented successful empty page yields zero transactions and no error', async () => {
  const supabase = createMockSupabase({ seed: baseSeed() });
  const result = await withPatchedFetch(
    () => syncCurrentMonthTx(supabase, OUTLET, {}),
    async () => ({ data: { payments: [], completed: true } }),
  );
  assert.equal(result.totalTx, 0);
  assert.equal(supabase._store.moka_stockist_sync_state[0].last_status, 'SUCCESS');
});

// ── Test C — 404 must fail loudly, not look like zero transactions ──────
test('Test C: a 404 from the transactions endpoint fails the sync visibly', async () => {
  const supabase = createMockSupabase({ seed: baseSeed() });
  await assert.rejects(
    () => withPatchedFetch(
      () => syncCurrentMonthTx(supabase, OUTLET, {}),
      async () => { throw Object.assign(new Error('Moka API GET ... -> 404'), { status: 404, code: 'MOKA_API_ERROR' }); },
    ),
    /404/,
  );
  assert.equal(supabase._store.moka_stockist_sync_state[0].last_status, 'FAILED');
});

// ── Test D — 403 must fail loudly ───────────────────────────────────────
test('Test D: a 403 from the transactions endpoint fails the sync visibly', async () => {
  const supabase = createMockSupabase({ seed: baseSeed() });
  await assert.rejects(
    () => withPatchedFetch(
      () => syncCurrentMonthTx(supabase, OUTLET, {}),
      async () => { throw Object.assign(new Error('Moka API GET ... -> 403'), { status: 403, code: 'MOKA_API_ERROR' }); },
    ),
    /403/,
  );
  assert.equal(supabase._store.moka_stockist_sync_state[0].last_status, 'FAILED');
});

// ── Test E — invalid response envelope ──────────────────────────────────
test('Test E: an invalid response envelope fails the sync visibly instead of being read as empty', async () => {
  const supabase = createMockSupabase({ seed: baseSeed() });
  await assert.rejects(
    () => withPatchedFetch(
      () => syncCurrentMonthTx(supabase, OUTLET, {}),
      async () => ({}), // no `data` key at all
    ),
    /INVALID_MOKA_RESPONSE|Invalid Moka response/,
  );
  assert.equal(supabase._store.moka_stockist_sync_state[0].last_status, 'FAILED');
});

test('Test E2: a non-array data.payments fails the sync visibly', async () => {
  const supabase = createMockSupabase({ seed: baseSeed() });
  await assert.rejects(
    () => withPatchedFetch(
      () => syncCurrentMonthTx(supabase, OUTLET, {}),
      async () => ({ data: { payments: 'not-an-array' } }),
    ),
    /INVALID_MOKA_RESPONSE|Invalid Moka response/,
  );
});

// ── Test F — duplicate transaction across two sync runs ─────────────────
test('Test F: re-running the sync with the same transaction deducts stock only once', async () => {
  const supabase = createMockSupabase({ seed: baseSeed() });
  let rpcCalls = 0;
  supabase.rpc = async () => { rpcCalls += 1; return { data: { quantity_before: 10, quantity_after: 8 }, error: null }; };

  const page = async () => ({
    data: {
      payments: [{
        id: 'tx-f1', receipt_number: 'RB-F1', transaction_time: '2026-09-06T11:00:00Z',
        checkouts: [{ item_id: 'm-1', quantity: 2 }],
      }],
      completed: true,
    },
  });

  await withPatchedFetch(() => syncCurrentMonthTx(supabase, OUTLET, {}), page);
  await withPatchedFetch(() => syncCurrentMonthTx(supabase, OUTLET, {}), page);

  // apply_inventory_movement (the RPC) is the only thing that ever changes
  // inventory_balances/inventory_ledger — one call proves one deduction,
  // regardless of how many times the sync itself is re-run.
  assert.equal(rpcCalls, 1);
  assert.equal(supabase._store.moka_stockist_sales.length, 1);
});
