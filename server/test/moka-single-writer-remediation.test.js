'use strict';

// Task 2.1B regression suite: single-writer remediation for
// moka_barber_services. Prior to this task, two independent writers
// (syncCurrentMonthTx in server/moka/txSync.js, and
// syncMokaDailyTransactions/upsertBarberServices in
// server/services/mokaDailyTransactionSync.js) both upserted this table on
// the same (receipt_number, barber_id) conflict key, each computing
// revenue_share as an equal split across every barber found on a receipt —
// a P1 bug (37.5% of rows ended up 0, escalating to 100% for 2026-08-10..17).

const assert = require('node:assert/strict');
const test = require('node:test');

const MokaClient = require('../moka/client');
const { syncCurrentMonthTx } = require('../moka/txSync');
const { upsertBarberServices } = require('../services/mokaDailyTransactionSync');
const { calculateBarberCommission, STATUS } = require('../services/commissionCalculator');

function withPatchedFetch(fn, impl) {
  const original = MokaClient.prototype.getPaidTransactionsPage;
  MokaClient.prototype.getPaidTransactionsPage = impl;
  return fn().finally(() => { MokaClient.prototype.getPaidTransactionsPage = original; });
}

function fakeSupabaseRecorder() {
  const calls = [];
  const chain = (table) => ({
    select() { return chain(table); },
    eq() { return chain(table); },
    order() { return chain(table); },
    limit() { return chain(table); },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(resolve) { resolve({ data: [], error: null }); },
    upsert(rows, opts) {
      calls.push({ table, rows: Array.isArray(rows) ? rows : [rows], opts });
      return Promise.resolve({ data: rows, error: null });
    },
  });
  return {
    calls,
    from(table) { return chain(table); },
  };
}

// -------------------------------------------------------------------------
// A & B: single-writer enforcement
// -------------------------------------------------------------------------

test('A: syncCurrentMonthTx (the non-canonical path) never writes moka_barber_services', async () => {
  const supabase = fakeSupabaseRecorder();
  const outlet = { id: 'outlet-1', slug: 'bypass', moka_outlet_id: 'moka-1' };

  await withPatchedFetch(
    () => syncCurrentMonthTx(supabase, outlet, { stockistSalesSync: false }),
    async () => ({
      data: {
        completed: true,
        payments: [{
          id: 'r-1', receipt_number: 'r-1', transaction_time: '2026-09-01T10:00:00Z',
          net_sales: 100000, gross_sales: 100000, total_collected: 100000,
          checkouts: [{ name: 'Abdul', variant_name: 'Hair Cut' }],
        }],
      },
    }),
  );

  const barberServiceWrites = supabase.calls.filter((c) => c.table === 'moka_barber_services');
  assert.equal(barberServiceWrites.length, 0, 'syncCurrentMonthTx must never write to moka_barber_services');

  const txWrites = supabase.calls.filter((c) => c.table === 'moka_transactions');
  assert.ok(txWrites.length >= 1, 'syncCurrentMonthTx must still write moka_transactions (different table, different purpose)');
});

test('B: the canonical writer cannot be silently overwritten by the deprecated path', async () => {
  // With A proven (txSync never touches moka_barber_services at all), there
  // is structurally nothing left that could overwrite a canonical row —
  // this test documents that invariant explicitly rather than re-deriving it.
  const { syncCurrentMonthTx: fn } = require('../moka/txSync');
  assert.equal(typeof fn, 'function');
  // No moka_barber_services write path exists in this module at all — only
  // a documentation comment referencing the table name is allowed to
  // remain, not an actual .from('moka_barber_services') call.
  const src = fn.toString();
  assert.equal(/from\(\s*['"]moka_barber_services['"]\s*\)/.test(src), false, 'syncCurrentMonthTx must not call supabase.from(\'moka_barber_services\')');
});

// -------------------------------------------------------------------------
// C & D: equal split removed, zero-regression reproduced and fixed
// -------------------------------------------------------------------------

test('M: upsertBarberServices upserts on the constraint that actually exists in production', async () => {
  // Root cause of "nothing synced since 2026-08-17": the live schema only
  // has a unique constraint on (receipt_number, barber_name_raw,
  // service_name) — moka_barber_services_receipt_number_barber_name_raw_service_key
  // — not (receipt_number, barber_id). Every prior upsert using the latter
  // failed with a Postgres "no unique or exclusion constraint matching the
  // ON CONFLICT specification" error and wrote zero rows (187/187 logged
  // cron runs failed this way). This locks in the fix.
  const supabase = fakeSupabaseRecorder();
  const barbers = [{ id: 'abdul', name: 'Abdul', branch: 'bypass' }];
  const rows = [{
    receipt_number: 'r-conflict', outlet_slug: 'bypass', tx_date: '2026-09-17', net_sales: 85000,
    _barber_items: [{ name: 'Abdul', service: 'Hair Cut+' }],
  }];
  await upsertBarberServices(supabase, rows, barbers);
  const call = supabase.calls.find((c) => c.table === 'moka_barber_services');
  assert.equal(call.opts?.onConflict, 'receipt_number,barber_name_raw,service_name');
  assert.notEqual(call.opts?.onConflict, 'receipt_number,barber_id', 'this exact key does not exist as a constraint in production');
});

test('C: upsertBarberServices never computes an equal split — revenue_share is always null', async () => {
  const supabase = fakeSupabaseRecorder();
  const barbers = [
    { id: 'epik', name: 'Epik', branch: 'bypass' },
    { id: 'shepril', name: 'Shepril', branch: 'bypass' },
    { id: 'yafi', name: 'Yafi', branch: 'bypass' },
    { id: 'ahmad', name: 'Ahmad', branch: 'bypass' },
  ];
  const rows = [{
    receipt_number: '1K8VJRW', outlet_slug: 'bypass', tx_date: '2026-08-17', net_sales: 465000,
    _barber_items: [
      { name: 'Epik', service: 'Hair Cut with Fade' },
      { name: 'Shepril', service: 'Hair Cut' },
      { name: 'Yafi', service: 'Redbox Baron Grooming' },
      { name: 'Ahmad', service: 'Redbox Baron Grooming' },
    ],
  }];

  const count = await upsertBarberServices(supabase, rows, barbers);
  assert.equal(count, 4);
  const writes = supabase.calls.filter((c) => c.table === 'moka_barber_services').flatMap((c) => c.rows);
  assert.equal(writes.length, 4);
  for (const row of writes) {
    assert.equal(row.revenue_share, null, `revenue_share must be null, never a computed equal split (found ${row.revenue_share} for ${row.barber_id})`);
    assert.notEqual(row.revenue_share, 116250, 'must not reproduce the old 465000/4 equal-split value');
  }
});

test('D: reproduces the real zero-regression shape and confirms it no longer silently writes 0', async () => {
  // Real production pattern: receipt 1K8VJRW, 2026-08-17, 4 barbers + a
  // drink line (the drink is not itself a barber, so it never entered
  // _barber_items — matchBarberName would only ever be called on real names
  // upstream; this test isolates upsertBarberServices's own arithmetic).
  const supabase = fakeSupabaseRecorder();
  const barbers = [{ id: 'ahmad', name: 'Ahmad', branch: 'bypass' }];
  const rows = [{
    receipt_number: '1K8VJRW', outlet_slug: 'bypass', tx_date: '2026-08-17', net_sales: 465000,
    _barber_items: [{ name: 'Ahmad', service: 'Redbox Baron Grooming' }],
  }];
  await upsertBarberServices(supabase, rows, barbers);
  const [row] = supabase.calls.find((c) => c.table === 'moka_barber_services').rows;
  // Before this fix: revenue_share would be Math.round(465000/1) = 465000 in
  // THIS single-barber case, or 0 whenever net_sales/matched happened to
  // read as 0 at write time — either way, a number that looks like a real,
  // trustworthy amount. Now it is explicitly null: nobody downstream can
  // mistake "we don't know" for "this barber earned $0".
  assert.equal(row.revenue_share, null);
});

// -------------------------------------------------------------------------
// E-J: commissionCalculator business-rule regressions (Task 2.1B decisions)
// -------------------------------------------------------------------------

const ABDUL = { id: 'bypass-abdul-dul', name: 'Abdul' };

test('E: mixed service+retail without item price stays REVIEW_REQUIRED (never partially guessed)', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'e1', net_sales: 150000, status: 'payment' },
    items: [
      { moka_item_id: 'svc', barber_name: 'Abdul', service_name: 'Hair Cut' },
      { moka_item_id: 'retail', barber_name: 'Abdul', service_name: 'Pomade' },
    ],
    barber: ABDUL, commissionRate: 0.3,
    itemMappings: [
      { moka_item_id: 'svc', moka_variant_id: null, outlet_id: null, classification: 'NON_STOCK_SERVICE' },
      { moka_item_id: 'retail', moka_variant_id: null, outlet_id: null, classification: 'STOCK_PRODUCT' },
    ],
  });
  assert.equal(result.status, STATUS.REVIEW_REQUIRED);
  assert.equal(result.commissionable_amount, null);
});

test('F: multi-barber without item price is REVIEW_REQUIRED, never split', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'f1', net_sales: 300000, status: 'payment' },
    items: [
      { barber_name: 'Abdul', service_name: 'Hair Cut' },
      { barber_name: 'Onoy', service_name: 'Hair Cut' },
    ],
    barber: ABDUL, commissionRate: 0.3,
  });
  assert.equal(result.status, STATUS.REVIEW_REQUIRED);
  assert.notEqual(result.commissionable_amount, 150000, 'must not equal-split 300000/2');
  assert.equal(result.commissionable_amount, null);
});

test('G: receipt-level discount that cannot be allocated to a specific service item => REVIEW_REQUIRED', () => {
  // Approved rule: commission base is net service revenue after discount,
  // but only when it can be computed deterministically. A single barber
  // receipt with one service item and no other items is unambiguous (the
  // whole net_sales, already post-discount, belongs to that one service).
  const clean = calculateBarberCommission({
    transaction: { id: 'g1', net_sales: 60000, gross_sales: 75000, status: 'payment' },
    items: [{ moka_item_id: 'svc', barber_name: 'Abdul', service_name: 'Hair Cut' }],
    barber: ABDUL, commissionRate: 0.3,
    itemMappings: [{ moka_item_id: 'svc', moka_variant_id: null, outlet_id: null, classification: 'NON_STOCK_SERVICE' }],
  });
  assert.equal(clean.status, STATUS.READY);
  assert.equal(clean.commissionable_amount, 60000, 'net_sales (post-discount) is used, not gross_sales');

  // But once a second, differently-classified item shares the same receipt,
  // the discount can no longer be attributed to "the service portion" from
  // receipt-level totals alone.
  const ambiguous = calculateBarberCommission({
    transaction: { id: 'g2', net_sales: 85000, gross_sales: 100000, status: 'payment' },
    items: [
      { moka_item_id: 'svc', barber_name: 'Abdul', service_name: 'Hair Cut' },
      { moka_item_id: 'retail', barber_name: 'Abdul', service_name: 'Pomade' },
    ],
    barber: ABDUL, commissionRate: 0.3,
    itemMappings: [
      { moka_item_id: 'svc', moka_variant_id: null, outlet_id: null, classification: 'NON_STOCK_SERVICE' },
      { moka_item_id: 'retail', moka_variant_id: null, outlet_id: null, classification: 'STOCK_PRODUCT' },
    ],
  });
  assert.equal(ambiguous.status, STATUS.REVIEW_REQUIRED);
});

test('H: tax is never added into the commission base, even if present on the transaction', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'h1', net_sales: 60000, tax: 6000, status: 'payment' },
    items: [{ moka_item_id: 'svc', barber_name: 'Abdul', service_name: 'Hair Cut', price: 60000 }],
    barber: ABDUL, commissionRate: 0.3,
    itemMappings: [{ moka_item_id: 'svc', moka_variant_id: null, outlet_id: null, classification: 'NON_STOCK_SERVICE' }],
  });
  assert.equal(result.commissionable_amount, 60000, 'tax must never inflate the commission base');
});

test('I: gratuity/tip is never added into the commission base, even if present on the transaction', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'i1', net_sales: 60000, gratuity: 10000, status: 'payment' },
    items: [{ moka_item_id: 'svc', barber_name: 'Abdul', service_name: 'Hair Cut', price: 60000 }],
    barber: ABDUL, commissionRate: 0.3,
    itemMappings: [{ moka_item_id: 'svc', moka_variant_id: null, outlet_id: null, classification: 'NON_STOCK_SERVICE' }],
  });
  assert.equal(result.commissionable_amount, 60000, 'gratuity must never enter the commission base');
});

test('J: legacy moka_barber_services.revenue_share is never read or trusted by the calculator', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'j1', net_sales: 60000, status: 'payment' },
    items: [{
      moka_item_id: 'svc', barber_name: 'Abdul', service_name: 'Hair Cut', price: 60000,
      // A legacy equal-split value smuggled onto the item — must be ignored entirely.
      revenue_share: 999999,
    }],
    barber: ABDUL, commissionRate: 0.3,
    itemMappings: [{ moka_item_id: 'svc', moka_variant_id: null, outlet_id: null, classification: 'NON_STOCK_SERVICE' }],
  });
  assert.equal(result.commissionable_amount, 60000);
  assert.equal(result.calculated_commission, 18000);
});

// -------------------------------------------------------------------------
// K & L: retry / idempotency
// -------------------------------------------------------------------------

test('K: calling upsertBarberServices twice with identical input is idempotent (same rows, same values)', async () => {
  const supabase1 = fakeSupabaseRecorder();
  const supabase2 = fakeSupabaseRecorder();
  const barbers = [{ id: 'abdul', name: 'Abdul', branch: 'bypass' }];
  const rows = [{
    receipt_number: 'r-retry', outlet_slug: 'bypass', tx_date: '2026-09-01', net_sales: 85000,
    _barber_items: [{ name: 'Abdul', service: 'Hair Cut+' }],
  }];

  await upsertBarberServices(supabase1, rows, barbers);
  await upsertBarberServices(supabase2, rows, barbers);

  const rows1 = supabase1.calls.find((c) => c.table === 'moka_barber_services').rows;
  const rows2 = supabase2.calls.find((c) => c.table === 'moka_barber_services').rows;
  assert.deepEqual(rows1, rows2, 'retrying the same input must produce byte-identical output rows');
});

test('L: re-syncing the same receipt twice produces the same canonical commission result', () => {
  const items = [{ moka_item_id: 'svc', barber_name: 'Abdul', service_name: 'Hair Cut+', price: 85000 }];
  const itemMappings = [{ moka_item_id: 'svc', moka_variant_id: null, outlet_id: null, classification: 'NON_STOCK_SERVICE' }];
  const params = { transaction: { id: 'l1', net_sales: 85000, status: 'payment' }, items, barber: ABDUL, commissionRate: 0.3, itemMappings };
  const first = calculateBarberCommission(params);
  const second = calculateBarberCommission(params);
  assert.deepEqual(first, second, 'the pure function must be deterministic across repeated calls with the same input');
});
