'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  extractMokaSaleLines,
  normalizeMokaTransaction,
  buildMokaSalePlan,
  processMokaSale,
} = require('../services/stockistMokaSync');

test('normalizes stable transaction identity and final status', () => {
  const result = normalizeMokaTransaction({ id: 991, receipt_number: 'RB-991', status: 'paid' }, { id: 'out-1', slug: 'csb' });
  assert.deepEqual(result, {
    externalId: '991', receiptNumber: 'RB-991', outletId: 'out-1', outletSlug: 'csb',
    status: 'PAID', occurredAt: null, isFinal: true,
  });
});

test('extracts item id, variant id, and quantity from Moka line items', () => {
  const lines = extractMokaSaleLines({ items: [{ id: 'm-1', variant_id: 'v-1', name: 'Pomade', quantity: 2 }] });
  assert.deepEqual(lines, [{ mokaItemId: 'm-1', mokaVariantId: 'v-1', name: 'Pomade', quantity: 2 }]);
});

test('does not produce a sale plan for a void or non-final transaction', () => {
  const result = buildMokaSalePlan({ id: 'tx-1', status: 'VOID' }, { id: 'out-1' }, { locationId: 'loc-1' });
  assert.equal(result.action, 'SKIP');
  assert.equal(result.reason, 'NOT_FINAL');
});

test('fails closed on a final transaction with no line items', () => {
  const result = buildMokaSalePlan({ id: 'tx-2' }, { id: 'out-1' }, { locationId: 'loc-1' });
  assert.equal(result.action, 'FAILED');
  assert.equal(result.errorCode, 'MOKA_LINE_ITEMS_REQUIRED');
});

// Moka's v3 Report API (get_latest_transactions) — the endpoint the fetch
// layer actually calls — never includes a status field at all; it only
// ever returns settled transactions (voids are flagged via is_deleted /
// is_refunded instead). A payment shaped like this is real, everyday
// production data, not malformed input — treating "no status field" as
// "unknown, so skip" is exactly what silently dropped every transaction
// even after the endpoint itself was fixed.
test('a v3-report-shaped payment (no status field) with real line items is processable', () => {
  const result = buildMokaSalePlan(
    { id: 'tx-v3-1', receipt_number: 'RB-500', checkouts: [{ item_id: 'm-1', quantity: 2 }] },
    { id: 'out-1' },
    { locationId: 'loc-1', mappings: [{ moka_item_id: 'm-1', product_id: 'p-1', classification: 'STOCK_PRODUCT' }] },
  );
  assert.equal(result.action, 'PROCESS');
  assert.equal(result.lines[0].productId, 'p-1');
  assert.equal(result.lines[0].quantity, 2);
});

test('a v3-report-shaped payment still skips on is_deleted/is_refunded despite having no status field', () => {
  const deleted = buildMokaSalePlan({ id: 'tx-v3-2', is_deleted: true, checkouts: [{ item_id: 'm-1', quantity: 1 }] },
    { id: 'out-1' }, { locationId: 'loc-1', mappings: [{ moka_item_id: 'm-1', product_id: 'p-1' }] });
  assert.equal(deleted.action, 'SKIP');
  assert.equal(deleted.reason, 'NOT_FINAL');

  const refunded = buildMokaSalePlan({ id: 'tx-v3-3', is_refunded: true, checkouts: [{ item_id: 'm-1', quantity: 1 }] },
    { id: 'out-1' }, { locationId: 'loc-1', mappings: [{ moka_item_id: 'm-1', product_id: 'p-1' }] });
  assert.equal(refunded.action, 'SKIP');
  assert.equal(refunded.reason, 'NOT_FINAL');
});

test('extracts line items from checkouts[] (the confirmed v3 report field name)', () => {
  const lines = extractMokaSaleLines({
    checkouts: [{ item_id: 'm-1', item_variant_id: 'v-1', item_variant_name: 'Large', quantity: 3 }],
  });
  assert.deepEqual(lines, [{ mokaItemId: 'm-1', mokaVariantId: 'v-1', name: 'Large', quantity: 3 }]);
});

test('unmapped item fails closed instead of silently reducing stock', () => {
  const result = buildMokaSalePlan(
    { id: 'tx-1', status: 'PAID', items: [{ id: 'm-unknown', quantity: 1 }] },
    { id: 'out-1' },
    { locationId: 'loc-1', mappings: [] },
  );
  assert.equal(result.action, 'FAILED_MAPPING');
  assert.equal(result.unmapped[0].mokaItemId, 'm-unknown');
});

test('maps variant-specific products before item-level fallback', () => {
  const result = buildMokaSalePlan(
    { id: 'tx-1', status: 'PAID', items: [{ id: 'm-1', variant_id: 'v-2', quantity: 2 }] },
    { id: 'out-1' },
    {
      locationId: 'loc-1',
      mappings: [
        { moka_item_id: 'm-1', product_id: 'p-item', classification: 'STOCK_PRODUCT' },
        { moka_item_id: 'm-1', moka_variant_id: 'v-2', product_id: 'p-variant', classification: 'STOCK_PRODUCT' },
      ],
    },
  );
  assert.equal(result.action, 'PROCESS');
  assert.equal(result.lines[0].productId, 'p-variant');
});

test('requires a server-side actor before any Moka sale can mutate stock', async () => {
  const result = await processMokaSale({}, {
    payment: { id: 'tx-1', status: 'PAID', items: [{ id: 'm-1', quantity: 1 }] },
    outlet: { id: 'out-1' }, locationId: 'loc-1', mappings: [{ moka_item_id: 'm-1', product_id: 'p-1' }],
  });
  assert.equal(result.action, 'FAILED');
  assert.equal(result.errorCode, 'SYSTEM_ACTOR_REQUIRED');
});

// ── Minimal in-memory Supabase mock for exercising the full write path ─────
function createMockSupabase({ rpc } = {}) {
  const store = {};
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
          const existing = keys.length ? table(name).find((row) => keys.every((k) => row[k] === payload[k])) : null;
          const row = existing ? Object.assign(existing, payload) : { id: uid(), ...payload };
          if (!existing) table(name).push(row);
          return { data: single ? row : [row], error: null };
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
    rpc: rpc || (async () => { throw new Error('rpc not mocked for this test'); }),
  };
}

const OUTLET = { id: 'out-csb', slug: 'csb' };
const MAPPING = [{ moka_item_id: 'm-hairpowder', product_id: 'p-hairpowder', classification: 'STOCK_PRODUCT' }];

test('Case 1 — normal sale deducts stock and writes a SALE_MOKA ledger entry', async () => {
  let ledgerCall = null;
  const supabase = createMockSupabase({
    rpc: async (fn, params) => {
      assert.equal(fn, 'apply_inventory_movement');
      ledgerCall = params;
      return { data: { quantity_before: 13, quantity_after: 11 }, error: null };
    },
  });
  const result = await processMokaSale(supabase, {
    payment: { id: 'tx-100', status: 'PAID', items: [{ id: 'm-hairpowder', quantity: 2 }] },
    outlet: OUTLET, locationId: 'loc-csb', mappings: MAPPING, performedBy: 'owner-1',
  });
  assert.equal(result.action, 'PROCESSED');
  assert.equal(result.quantityDeducted, 2);
  assert.equal(ledgerCall.p_movement_type, 'SALE_MOKA');
  assert.equal(ledgerCall.p_quantity_delta, -2);
});

test('Case 2 — duplicate transaction is only ever deducted once', async () => {
  const supabase = createMockSupabase({
    rpc: async () => ({ data: { quantity_before: 10, quantity_after: 9 }, error: null }),
  });
  const args = {
    payment: { id: 'tx-dup', status: 'PAID', items: [{ id: 'm-hairpowder', quantity: 1 }] },
    outlet: OUTLET, locationId: 'loc-csb', mappings: MAPPING, performedBy: 'owner-1',
  };
  const first = await processMokaSale(supabase, args);
  const second = await processMokaSale(supabase, args);
  assert.equal(first.action, 'PROCESSED');
  assert.equal(second.action, 'SKIPPED_DUPLICATE');
  assert.equal(second.saleId, first.saleId);
});

test('Case 3 — unmapped item does not touch stock and lands in the anomaly queue', async () => {
  const supabase = createMockSupabase();
  const result = await processMokaSale(supabase, {
    payment: { id: 'tx-unmapped', status: 'PAID', items: [{ id: 'm-unknown', quantity: 1 }] },
    outlet: OUTLET, locationId: 'loc-csb', mappings: MAPPING, performedBy: 'owner-1',
  });
  assert.equal(result.action, 'FAILED_MAPPING');
  assert.equal(supabase._store.moka_stockist_sales?.length ?? 0, 0);
  const anomalies = supabase._store.moka_stockist_anomalies;
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].anomaly_type, 'UNMAPPED_PRODUCT');
  assert.equal(anomalies[0].outlet_id, OUTLET.id);
});

test('Case 4 — Bypass legacy Moka ending stock is never read or applied', () => {
  // buildMokaSalePlan only ever derives a quantity_delta from line-item
  // quantity — it has no code path that reads an "ending_stock" / "current_stock"
  // field, so a legacy Moka payload carrying one (e.g. 947) cannot influence
  // the applied delta. A Bypass sale of 1 always deducts exactly 1.
  const result = buildMokaSalePlan(
    { id: 'tx-bypass', status: 'PAID', ending_stock: 947, current_stock: 947, items: [{ id: 'm-hairpowder', quantity: 1 }] },
    { id: 'out-bypass', slug: 'bypass' },
    { locationId: 'loc-bypass', mappings: MAPPING },
  );
  assert.equal(result.action, 'PROCESS');
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].quantity, 1);
});

test('Case 5 — negative stock risk is not applied and is queued as an anomaly', async () => {
  const supabase = createMockSupabase({
    rpc: async () => {
      const err = new Error('insufficient stock: product p-hairpowder at location loc-csb has 1 available, delta -3 requested');
      err.code = '23514';
      return { data: null, error: err };
    },
  });
  supabase._store.inventory_balances = [{ product_id: 'p-hairpowder', location_id: 'loc-csb', quantity: 1 }];

  const result = await processMokaSale(supabase, {
    payment: { id: 'tx-negative', status: 'PAID', items: [{ id: 'm-hairpowder', quantity: 3 }] },
    outlet: OUTLET, locationId: 'loc-csb', mappings: MAPPING, performedBy: 'owner-1',
  });

  assert.equal(result.action, 'PARTIAL');
  const anomalies = supabase._store.moka_stockist_anomalies;
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].anomaly_type, 'NEGATIVE_STOCK_RISK');
  assert.equal(anomalies[0].requested_quantity, 3);
  assert.equal(anomalies[0].available_quantity, 1);
  const sale = supabase._store.moka_stockist_sales[0];
  assert.equal(sale.processing_status, 'PARTIAL');
});

// ── Product classification (2026-09-07 mapping-safety fix) ────────────────
// A 2026-08-20 bulk import had mapped Moka's entire catalog — including
// coffee, snacks, and haircuts — as if every item were real Stockist
// retail stock. These tests lock in the fix: only an explicit, active
// STOCK_PRODUCT classification may ever deduct inventory.

test('a haircut-only transaction (classified NON_STOCK_SERVICE) never touches stock and is not an anomaly', () => {
  const result = buildMokaSalePlan(
    { id: 'tx-haircut', status: 'PAID', items: [{ id: 'm-haircut', quantity: 1 }] },
    { id: 'out-1' },
    { locationId: 'loc-1', mappings: [{ moka_item_id: 'm-haircut', product_id: null, classification: 'NON_STOCK_SERVICE' }] },
  );
  assert.equal(result.action, 'SKIP');
  assert.equal(result.reason, 'NO_STOCK_LINES');
});

test('a coffee-only transaction (classified NON_STOCK_MISC) never touches stock', () => {
  const result = buildMokaSalePlan(
    { id: 'tx-coffee', status: 'PAID', items: [{ id: 'm-coffee', quantity: 2 }] },
    { id: 'out-1' },
    { locationId: 'loc-1', mappings: [{ moka_item_id: 'm-coffee', product_id: 'p-coffee-legacy', classification: 'NON_STOCK_MISC' }] },
  );
  assert.equal(result.action, 'SKIP');
  assert.equal(result.reason, 'NO_STOCK_LINES');
});

test('a mixed transaction only deducts the real STOCK_PRODUCT line, ignoring the haircut line', () => {
  const result = buildMokaSalePlan(
    {
      id: 'tx-mixed', status: 'PAID',
      items: [{ id: 'm-haircut', quantity: 1 }, { id: 'm-pomade', quantity: 2 }],
    },
    { id: 'out-1' },
    {
      locationId: 'loc-1',
      mappings: [
        { moka_item_id: 'm-haircut', product_id: null, classification: 'NON_STOCK_SERVICE' },
        { moka_item_id: 'm-pomade', product_id: 'p-pomade', classification: 'STOCK_PRODUCT' },
      ],
    },
  );
  assert.equal(result.action, 'PROCESS');
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].productId, 'p-pomade');
});

test('a REVIEW_REQUIRED classified line never deducts stock and still raises an anomaly', () => {
  const result = buildMokaSalePlan(
    { id: 'tx-review', status: 'PAID', items: [{ id: 'm-ambiguous', quantity: 1 }] },
    { id: 'out-1' },
    { locationId: 'loc-1', mappings: [{ moka_item_id: 'm-ambiguous', product_id: null, classification: 'REVIEW_REQUIRED' }] },
  );
  assert.equal(result.action, 'FAILED_MAPPING');
  assert.equal(result.unmapped[0].mokaItemId, 'm-ambiguous');
});

// ── Fail-closed classification (PR #75 re-review, blocker 1) ──────────────
// A missing/null/unrecognized classification must NEVER be treated as
// STOCK_PRODUCT — it must never have silently defaulted to permissive
// behavior, even though a mapping row with a real product_id existed.

test('a mapping with product_id but a MISSING classification field never deducts stock', () => {
  const result = buildMokaSalePlan(
    { id: 'tx-missing-class', status: 'PAID', items: [{ id: 'm-legacy', quantity: 1 }] },
    { id: 'out-1' },
    { locationId: 'loc-1', mappings: [{ moka_item_id: 'm-legacy', product_id: 'p-real' }] }, // no `classification` key at all
  );
  assert.equal(result.action, 'FAILED_MAPPING');
  assert.equal(result.unmapped[0].mokaItemId, 'm-legacy');
});

test('a mapping with product_id but classification: null never deducts stock', () => {
  const result = buildMokaSalePlan(
    { id: 'tx-null-class', status: 'PAID', items: [{ id: 'm-null-class', quantity: 1 }] },
    { id: 'out-1' },
    { locationId: 'loc-1', mappings: [{ moka_item_id: 'm-null-class', product_id: 'p-real', classification: null }] },
  );
  assert.equal(result.action, 'FAILED_MAPPING');
  assert.equal(result.unmapped[0].mokaItemId, 'm-null-class');
});

test('a mapping with an unrecognized classification value never deducts stock', () => {
  const result = buildMokaSalePlan(
    { id: 'tx-bad-class', status: 'PAID', items: [{ id: 'm-typo', quantity: 1 }] },
    { id: 'out-1' },
    { locationId: 'loc-1', mappings: [{ moka_item_id: 'm-typo', product_id: 'p-real', classification: 'stock_product' }] }, // wrong case / typo
  );
  assert.equal(result.action, 'FAILED_MAPPING');
  assert.equal(result.unmapped[0].mokaItemId, 'm-typo');
});

test('a mapping row disabled for reasons other than non-stock classification still surfaces as unmapped', () => {
  // classification stays STOCK_PRODUCT but is_active=false (e.g. manually
  // disabled while a product mapping is corrected) — this must NOT be
  // silently ignored like a real non-stock item; it should still raise
  // an anomaly so someone notices the real product isn't syncing.
  const result = buildMokaSalePlan(
    { id: 'tx-disabled', status: 'PAID', items: [{ id: 'm-disabled', quantity: 1 }] },
    { id: 'out-1' },
    { locationId: 'loc-1', mappings: [{ moka_item_id: 'm-disabled', product_id: 'p-1', classification: 'STOCK_PRODUCT', is_active: false }] },
  );
  assert.equal(result.action, 'FAILED_MAPPING');
});

test('Case 6 — restart after a mid-run failure does not double-deduct', async () => {
  let rpcCalls = 0;
  const supabase = createMockSupabase({
    rpc: async () => { rpcCalls += 1; return { data: { quantity_before: 5, quantity_after: 4 }, error: null }; },
  });
  const args = {
    payment: { id: 'tx-restart', status: 'PAID', items: [{ id: 'm-hairpowder', quantity: 1 }] },
    outlet: OUTLET, locationId: 'loc-csb', mappings: MAPPING, performedBy: 'owner-1',
  };
  const first = await processMokaSale(supabase, args);
  // Simulate the job being re-run (e.g. after a crash) with the exact same
  // already-fetched transaction.
  const rerun = await processMokaSale(supabase, args);
  assert.equal(first.action, 'PROCESSED');
  assert.equal(rerun.action, 'SKIPPED_DUPLICATE');
  assert.equal(rpcCalls, 1);
});
